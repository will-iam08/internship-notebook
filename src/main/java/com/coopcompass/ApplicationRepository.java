package com.coopcompass;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

public final class ApplicationRepository {
    private static final Duration RECENTLY_DELETED_RETENTION = Duration.ofDays(7);
    private static final int EXTENDED_COLUMNS = 18;
    static final int MAX_NOTES = 10_000;

    private final Path dataFile;
    private final Clock clock;
    private final Map<Long, Application> applications = new LinkedHashMap<>();
    private final Map<Long, DeletedApplication> recentlyDeleted = new LinkedHashMap<>();
    private final AtomicLong nextId = new AtomicLong(1);

    public ApplicationRepository(Path dataFile) throws IOException {
        this(dataFile, Clock.systemUTC());
    }

    ApplicationRepository(Path dataFile, Clock clock) throws IOException {
        this.dataFile = dataFile.toAbsolutePath().normalize();
        this.clock = clock;
        load();
        purgeExpiredAndSave();
    }

    public synchronized List<Application> list() throws IOException {
        purgeExpiredAndSave();
        return applications.values().stream()
                .sorted(Comparator.comparing(Application::createdAt).reversed())
                .toList();
    }

    public synchronized Application create(Map<String, String> input) throws IOException {
        purgeExpiredAndSave();
        String company = required(input, "company", 80);
        String role = required(input, "role", 100);
        String location = optional(input, "location", 80);
        String source = optional(input, "source", 60);
        String notes = optional(input, "notes", MAX_NOTES);
        String deadline = date(input.getOrDefault("deadline", ""), "Deadline");
        Application.Status status = Application.Status.from(input.get("status"));
        List<String> skills = skills(input.getOrDefault("skills", ""));
        String link = link(input.getOrDefault("link", ""));
        String contact = optional(input, "contact", 120);
        String nextStep = optional(input, "nextStep", 140);
        String nextStepDate = date(input.getOrDefault("nextStepDate", ""), "Next step date");
        boolean starred = Boolean.parseBoolean(input.getOrDefault("starred", "false"));
        Instant now = clock.instant();

        Application application = new Application(nextId.getAndIncrement(), company, role, location, source, status,
                deadline, notes, skills, now, link, contact, nextStep, nextStepDate, starred,
                List.of(new Application.StatusChange(status, now)), now);
        applications.put(application.id(), application);
        try {
            save();
        } catch (IOException exception) {
            applications.remove(application.id());
            throw exception;
        }
        return application;
    }

    public synchronized ImportedApplications importBackup(List<Map<String, String>> active,
                                                          List<Map<String, String>> deleted) throws IOException {
        Instant now = clock.instant();
        Instant cutoff = now.minus(RECENTLY_DELETED_RETENTION);
        Set<List<String>> existing = new HashSet<>();
        applications.values().forEach(application -> existing.add(fingerprint(application)));
        recentlyDeleted.values().stream().filter(entry -> entry.deletedAt().isAfter(cutoff))
                .forEach(entry -> existing.add(fingerprint(entry.application())));
        List<Application> added = new ArrayList<>();
        List<DeletedApplication> addedDeleted = new ArrayList<>();
        long originalNextId = nextId.get();
        long importedNextId = originalNextId;
        for (int group = 0; group < 2; group++) {
            for (Map<String, String> input : group == 0 ? active : deleted) {
                Instant createdAt = timestamp(input.getOrDefault("createdAt", now.toString()), "createdAt");
                Instant updatedAt = timestamp(input.getOrDefault("updatedAt", createdAt.toString()), "updatedAt");
                Application.Status status = Application.Status.from(input.get("status"));
                Application application = new Application(importedNextId,
                        required(input, "company", 80), required(input, "role", 100),
                        optional(input, "location", 80), optional(input, "source", 60), status,
                        date(input.getOrDefault("deadline", ""), "Deadline"), optional(input, "notes", MAX_NOTES),
                        skills(input.getOrDefault("skills", "")), createdAt, link(input.getOrDefault("link", "")),
                        optional(input, "contact", 120), optional(input, "nextStep", 140),
                        date(input.getOrDefault("nextStepDate", ""), "Next step date"),
                        Boolean.parseBoolean(input.getOrDefault("starred", "false")),
                        history(input.getOrDefault("history", ""), status, createdAt), updatedAt);
                Instant deletedAt = group == 1 ? timestamp(input.get("deletedAt"), "deletedAt") : null;
                if (deletedAt != null && !deletedAt.isAfter(cutoff)) continue;
                if (!existing.add(fingerprint(application))) continue;
                if (importedNextId == Long.MAX_VALUE) throw new IllegalArgumentException("Too many notebook pages.");
                importedNextId++;
                if (deletedAt == null) added.add(application);
                else addedDeleted.add(new DeletedApplication(application, deletedAt));
            }
        }
        if (added.isEmpty() && addedDeleted.isEmpty()) return new ImportedApplications(List.of(), List.of());
        added.forEach(application -> applications.put(application.id(), application));
        addedDeleted.forEach(entry -> recentlyDeleted.put(entry.application().id(), entry));
        nextId.set(importedNextId);
        try {
            save();
        } catch (IOException exception) {
            added.forEach(application -> applications.remove(application.id()));
            addedDeleted.forEach(entry -> recentlyDeleted.remove(entry.application().id()));
            nextId.set(originalNextId);
            throw exception;
        }
        return new ImportedApplications(List.copyOf(added), List.copyOf(addedDeleted));
    }

    private static List<String> fingerprint(Application application) {
        return List.of(application.company().toLowerCase(Locale.ROOT), application.role().toLowerCase(Locale.ROOT),
                application.createdAt().toString());
    }

    private static Instant timestamp(String value, String field) {
        try {
            if (value == null) throw new IllegalArgumentException();
            return Instant.parse(value);
        } catch (IllegalArgumentException | DateTimeParseException exception) {
            throw new IllegalArgumentException(field + " must be a valid timestamp.");
        }
    }

    public synchronized Optional<Application> updateStatus(long id, String rawStatus) throws IOException {
        purgeExpiredAndSave();
        Application existing = applications.get(id);
        if (existing == null) return Optional.empty();
        Application updated = existing.withStatus(Application.Status.from(rawStatus), clock.instant());
        applications.put(id, updated);
        try {
            save();
        } catch (IOException exception) {
            applications.put(id, existing);
            throw exception;
        }
        return Optional.of(updated);
    }

    /**
     * Edits an active application. Only the fields present in {@code input} change, so the
     * notebook page can save one field at a time. A status change is added to the timeline.
     */
    public synchronized Optional<Application> update(long id, Map<String, String> input) throws IOException {
        purgeExpiredAndSave();
        Application existing = applications.get(id);
        if (existing == null) return Optional.empty();
        if (input == null || input.isEmpty()) throw new IllegalArgumentException("Nothing to update.");

        Instant now = clock.instant();
        Application edited = new Application(
                id,
                input.containsKey("company") ? required(input, "company", 80) : existing.company(),
                input.containsKey("role") ? required(input, "role", 100) : existing.role(),
                input.containsKey("location") ? optional(input, "location", 80) : existing.location(),
                input.containsKey("source") ? optional(input, "source", 60) : existing.source(),
                existing.status(),
                input.containsKey("deadline") ? date(input.get("deadline"), "Deadline") : existing.deadline(),
                input.containsKey("notes") ? optional(input, "notes", MAX_NOTES) : existing.notes(),
                input.containsKey("skills") ? skills(input.get("skills")) : existing.skills(),
                existing.createdAt(),
                input.containsKey("link") ? link(input.get("link")) : existing.link(),
                input.containsKey("contact") ? optional(input, "contact", 120) : existing.contact(),
                input.containsKey("nextStep") ? optional(input, "nextStep", 140) : existing.nextStep(),
                input.containsKey("nextStepDate") ? date(input.get("nextStepDate"), "Next step date") : existing.nextStepDate(),
                input.containsKey("starred") ? Boolean.parseBoolean(input.get("starred")) : existing.starred(),
                existing.history(),
                now);
        if (input.containsKey("status")) edited = edited.withStatus(requiredStatus(input.get("status")), now);

        applications.put(id, edited);
        try {
            save();
        } catch (IOException exception) {
            applications.put(id, existing);
            throw exception;
        }
        return Optional.of(edited);
    }

    /**
     * Changes the status of every requested active application in one save operation.
     * If any ID is not active, nothing is changed.
     */
    public synchronized Optional<List<Application>> updateStatuses(List<Long> ids, String rawStatus) throws IOException {
        purgeExpiredAndSave();
        List<Long> requestedIds = requiredIds(ids);
        Application.Status status = requiredStatus(rawStatus);
        List<Application> originals = activeApplications(requestedIds);
        if (originals == null) return Optional.empty();

        Instant changedAt = clock.instant();
        List<Application> updated = originals.stream().map(application -> application.withStatus(status, changedAt)).toList();
        updated.forEach(application -> applications.put(application.id(), application));
        try {
            save();
        } catch (IOException exception) {
            originals.forEach(application -> applications.put(application.id(), application));
            throw exception;
        }
        return Optional.of(updated);
    }

    public synchronized boolean delete(long id) throws IOException {
        purgeExpiredAndSave();
        Application application = applications.remove(id);
        if (application == null) return false;
        DeletedApplication deleted = new DeletedApplication(application, clock.instant());
        recentlyDeleted.put(id, deleted);
        try {
            save();
        } catch (IOException exception) {
            recentlyDeleted.remove(id);
            applications.put(id, application);
            throw exception;
        }
        return true;
    }

    /**
     * Soft-deletes every requested active application in one save operation.
     * If any ID is not active, nothing is moved to Recently Deleted.
     */
    public synchronized Optional<List<DeletedApplication>> deleteAll(List<Long> ids) throws IOException {
        purgeExpiredAndSave();
        List<Long> requestedIds = requiredIds(ids);
        List<Application> originals = activeApplications(requestedIds);
        if (originals == null) return Optional.empty();

        Instant deletedAt = clock.instant();
        List<DeletedApplication> deleted = originals.stream()
                .map(application -> new DeletedApplication(application, deletedAt))
                .toList();
        originals.forEach(application -> applications.remove(application.id()));
        deleted.forEach(application -> recentlyDeleted.put(application.application().id(), application));
        try {
            save();
        } catch (IOException exception) {
            deleted.forEach(application -> recentlyDeleted.remove(application.application().id()));
            originals.forEach(application -> applications.put(application.id(), application));
            throw exception;
        }
        return Optional.of(deleted);
    }

    public synchronized List<DeletedApplication> recentlyDeleted() throws IOException {
        purgeExpiredAndSave();
        return recentlyDeleted.values().stream()
                .sorted(Comparator.comparing(DeletedApplication::deletedAt).reversed())
                .toList();
    }

    public synchronized Optional<Application> restore(long id) throws IOException {
        purgeExpiredAndSave();
        DeletedApplication deleted = recentlyDeleted.remove(id);
        if (deleted == null) return Optional.empty();
        Application replaced = applications.put(id, deleted.application());
        try {
            save();
        } catch (IOException exception) {
            applications.remove(id);
            if (replaced != null) applications.put(id, replaced);
            recentlyDeleted.put(id, deleted);
            throw exception;
        }
        return Optional.of(deleted.application());
    }

    /**
     * Restores every requested Recently Deleted application in one save operation.
     * If any ID is no longer available, nothing is restored.
     */
    public synchronized Optional<List<Application>> restoreAll(List<Long> ids) throws IOException {
        purgeExpiredAndSave();
        List<Long> requestedIds = requiredIds(ids);
        List<DeletedApplication> originals = deletedApplications(requestedIds);
        if (originals == null || originals.stream().anyMatch(deleted -> applications.containsKey(deleted.application().id()))) {
            return Optional.empty();
        }

        List<Application> restored = originals.stream().map(DeletedApplication::application).toList();
        originals.forEach(deleted -> recentlyDeleted.remove(deleted.application().id()));
        restored.forEach(application -> applications.put(application.id(), application));
        try {
            save();
        } catch (IOException exception) {
            restored.forEach(application -> applications.remove(application.id()));
            originals.forEach(deleted -> recentlyDeleted.put(deleted.application().id(), deleted));
            throw exception;
        }
        return Optional.of(restored);
    }

    public synchronized boolean permanentlyDelete(long id) throws IOException {
        purgeExpiredAndSave();
        DeletedApplication deleted = recentlyDeleted.remove(id);
        if (deleted == null) return false;
        try {
            save();
        } catch (IOException exception) {
            recentlyDeleted.put(id, deleted);
            throw exception;
        }
        return true;
    }

    /**
     * Permanently removes every requested Recently Deleted application in one save operation.
     * If any ID is no longer available, nothing is removed.
     */
    public synchronized Optional<List<DeletedApplication>> permanentlyDeleteAll(List<Long> ids) throws IOException {
        purgeExpiredAndSave();
        List<Long> requestedIds = requiredIds(ids);
        List<DeletedApplication> originals = deletedApplications(requestedIds);
        if (originals == null) return Optional.empty();

        originals.forEach(deleted -> recentlyDeleted.remove(deleted.application().id()));
        try {
            save();
        } catch (IOException exception) {
            originals.forEach(deleted -> recentlyDeleted.put(deleted.application().id(), deleted));
            throw exception;
        }
        return Optional.of(originals);
    }

    public synchronized Dashboard dashboard() throws IOException {
        purgeExpiredAndSave();
        Map<Application.Status, Long> byStatus = new LinkedHashMap<>();
        for (Application.Status status : Application.Status.values()) {
            byStatus.put(status, applications.values().stream().filter(application -> application.status() == status).count());
        }
        long total = applications.size();
        List<Application.Status> submittedStages = List.of(Application.Status.APPLIED, Application.Status.INTERVIEW, Application.Status.OFFER);
        List<Application.Status> responseStages = List.of(Application.Status.INTERVIEW, Application.Status.OFFER, Application.Status.REJECTED);
        long sent = 0;
        long responses = 0;
        for (Application application : applications.values()) {
            boolean submitted = false;
            boolean responded = responseStages.contains(application.status());
            for (Application.StatusChange change : application.history()) {
                if (submittedStages.contains(change.status())) submitted = true;
                if (submitted && responseStages.contains(change.status())) responded = true;
            }
            if (submitted || submittedStages.contains(application.status())) {
                sent++;
                if (responded) responses++;
            }
        }
        int responseRate = sent == 0 ? 0 : (int) Math.round((responses * 100.0) / sent);
        return new Dashboard(total, byStatus, responseRate);
    }

    private void load() throws IOException {
        if (!Files.exists(dataFile)) return;
        int line = 0;
        for (String row : Files.readAllLines(dataFile, StandardCharsets.UTF_8)) {
            line++;
            if (row.isBlank()) continue;
            String[] values = row.split("\\t", -1);
            // 10/11 columns: rows written before notebook pages existed. 18 columns: current format.
            if (values.length != 10 && values.length != 11 && values.length != EXTENDED_COLUMNS) {
                throw new IOException("Notebook row " + line + " is unreadable. The original file has not been changed.");
            }
            try {
                long id = Long.parseLong(values[0]);
                if (id <= 0 || id == Long.MAX_VALUE || applications.containsKey(id) || recentlyDeleted.containsKey(id)) {
                    throw new IllegalArgumentException("Invalid or repeated application ID.");
                }
                Application.Status status = Application.Status.valueOf(values[5]);
                Instant createdAt = Instant.parse(values[9]);
                boolean extended = values.length >= EXTENDED_COLUMNS;
                Application application = new Application(id, decode(values[1]), decode(values[2]), decode(values[3]),
                        decode(values[4]), status, decode(values[6]), decode(values[7]),
                        skills(decode(values[8])), createdAt,
                        extended ? decode(values[11]) : "",
                        extended ? decode(values[12]) : "",
                        extended ? decode(values[13]) : "",
                        extended ? decode(values[14]) : "",
                        extended && "1".equals(values[15]),
                        extended ? history(values[16], status, createdAt) : List.of(new Application.StatusChange(status, createdAt)),
                        extended && !values[17].isBlank() ? Instant.parse(values[17]) : createdAt);
                String deletedAt = values.length >= 11 ? decode(values[10]) : "";
                if (deletedAt.isBlank()) {
                    recentlyDeleted.remove(id);
                    applications.put(id, application);
                } else {
                    applications.remove(id);
                    recentlyDeleted.put(id, new DeletedApplication(application, Instant.parse(deletedAt)));
                }
                nextId.set(Math.max(nextId.get(), id + 1));
            } catch (RuntimeException exception) {
                throw new IOException("Notebook row " + line + " is unreadable. The original file has not been changed.", exception);
            }
        }
    }

    private void save() throws IOException {
        Path parent = dataFile.getParent();
        Files.createDirectories(parent);
        List<String> rows = new ArrayList<>();
        applications.values().forEach(application -> rows.add(row(application, "")));
        recentlyDeleted.values().forEach(deleted -> rows.add(row(deleted.application(), deleted.deletedAt().toString())));

        Path temporaryFile = Files.createTempFile(parent, "." + dataFile.getFileName(), ".tmp");
        try {
            Files.write(temporaryFile, rows, StandardCharsets.UTF_8);
            try {
                Files.move(temporaryFile, dataFile, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporaryFile, dataFile, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporaryFile);
        }
    }

    private static String row(Application application, String deletedAt) {
        return String.join("\t",
                Long.toString(application.id()), encode(application.company()), encode(application.role()),
                encode(application.location()), encode(application.source()), application.status().name(),
                encode(application.deadline()), encode(application.notes()), encode(String.join(",", application.skills())),
                application.createdAt().toString(), deletedAt,
                encode(application.link()), encode(application.contact()), encode(application.nextStep()),
                encode(application.nextStepDate()), application.starred() ? "1" : "0",
                application.history().stream().map(change -> change.status().name() + "@" + change.at())
                        .collect(Collectors.joining(";")),
                application.updatedAt().toString());
    }

    private static List<Application.StatusChange> history(String raw, Application.Status status, Instant createdAt) {
        List<Application.StatusChange> changes = new ArrayList<>();
        if (raw.isBlank()) return List.of(new Application.StatusChange(status, createdAt));
        for (String entry : raw.split(";", -1)) {
            int separator = entry.indexOf('@');
            if (separator <= 0) throw new IllegalArgumentException("History must contain valid stages and timestamps.");
            changes.add(new Application.StatusChange(Application.Status.valueOf(entry.substring(0, separator)),
                    timestamp(entry.substring(separator + 1), "History time")));
        }
        return List.copyOf(changes);
    }

    private void purgeExpiredAndSave() throws IOException {
        if (purgeExpired()) save();
    }

    private List<Application> activeApplications(List<Long> ids) {
        List<Application> result = new ArrayList<>();
        for (long id : ids) {
            Application application = applications.get(id);
            if (application == null) return null;
            result.add(application);
        }
        return result;
    }

    private List<DeletedApplication> deletedApplications(List<Long> ids) {
        List<DeletedApplication> result = new ArrayList<>();
        for (long id : ids) {
            DeletedApplication deleted = recentlyDeleted.get(id);
            if (deleted == null) return null;
            result.add(deleted);
        }
        return result;
    }

    private static List<Long> requiredIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) throw new IllegalArgumentException("ids must contain at least one application ID.");
        Set<Long> uniqueIds = new HashSet<>();
        for (Long id : ids) {
            if (id == null || id <= 0) throw new IllegalArgumentException("ids must contain positive application IDs.");
            if (!uniqueIds.add(id)) throw new IllegalArgumentException("ids must not contain duplicate application IDs.");
        }
        return List.copyOf(ids);
    }

    private static Application.Status requiredStatus(String rawStatus) {
        if (rawStatus == null || rawStatus.isBlank()) throw new IllegalArgumentException("status is required.");
        return Application.Status.from(rawStatus);
    }

    private boolean purgeExpired() {
        Instant cutoff = clock.instant().minus(RECENTLY_DELETED_RETENTION);
        return recentlyDeleted.entrySet().removeIf(entry -> !entry.getValue().deletedAt().isAfter(cutoff));
    }

    private static String required(Map<String, String> input, String field, int maxLength) {
        String value = optional(input, field, maxLength);
        if (value.isBlank()) throw new IllegalArgumentException(field + " is required.");
        return value;
    }

    private static String optional(Map<String, String> input, String field, int maxLength) {
        String value = input.getOrDefault(field, "").trim();
        if (value.length() > maxLength) throw new IllegalArgumentException(field + " must be " + maxLength + " characters or fewer.");
        return value;
    }

    private static String date(String value, String label) {
        if (value == null || value.isBlank()) return "";
        try {
            return LocalDate.parse(value.trim()).toString();
        } catch (DateTimeParseException exception) {
            throw new IllegalArgumentException(label + " must be a valid date.");
        }
    }

    /** Accepts web links only, so a saved link can never run script when it is opened. */
    static String link(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (value.length() > 500) throw new IllegalArgumentException("link must be 500 characters or fewer.");
        if (!value.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) {
            if (value.matches("(?i)^[a-z][a-z0-9+.-]*:.*") && !value.matches("(?i)^[^:/]+\\.[^:/]+:\\d+.*")) {
                throw new IllegalArgumentException("Link must be a web address starting with http:// or https://.");
            }
            value = "https://" + value;
        }
        String lower = value.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw new IllegalArgumentException("Link must be a web address starting with http:// or https://.");
        }
        try {
            if (URI.create(value).getHost() == null) throw new IllegalArgumentException();
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Link must be a valid web address.");
        }
        return value;
    }

    private static List<String> skills(String rawSkills) {
        return java.util.Arrays.stream(rawSkills.split(","))
                .map(String::trim)
                .filter(skill -> !skill.isBlank())
                .map(skill -> skill.substring(0, 1).toUpperCase(Locale.ROOT) + skill.substring(1))
                .map(skill -> skill.substring(0, Math.min(40, skill.length())))
                .distinct()
                .limit(12)
                .collect(Collectors.toCollection(ArrayList::new));
    }

    private static String encode(String value) {
        return value.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
    }

    private static String decode(String value) {
        StringBuilder result = new StringBuilder();
        boolean escaping = false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (escaping) {
                result.append(switch (character) {
                    case 't' -> '\t'; case 'n' -> '\n'; case 'r' -> '\r'; case '\\' -> '\\';
                    default -> throw new IllegalArgumentException("Invalid notebook text escape.");
                });
                escaping = false;
            } else if (character == '\\') escaping = true;
            else result.append(character);
        }
        if (escaping) throw new IllegalArgumentException("Incomplete notebook text escape.");
        return result.toString();
    }

    public record DeletedApplication(Application application, Instant deletedAt) { }

    public record ImportedApplications(List<Application> applications, List<DeletedApplication> recentlyDeleted) { }

    public record Dashboard(long total, Map<Application.Status, Long> byStatus, int responseRate) { }
}
