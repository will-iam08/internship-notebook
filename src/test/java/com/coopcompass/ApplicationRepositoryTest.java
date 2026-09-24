package com.coopcompass;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

public final class ApplicationRepositoryTest {
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("coop-compass-test-");
        Path dataFile = directory.resolve("applications.tsv");
        Instant now = Instant.parse("2026-09-14T12:00:00Z");
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        ApplicationRepository repository = new ApplicationRepository(dataFile, clock);
        Application created = repository.create(Map.of(
                "company", "Acme", "role", "Software Developer", "status", "APPLIED",
                "skills", "java, REST APIs, PostgreSQL", "deadline", "2026-10-01"));

        assert created.id() == 1;
        assert repository.dashboard().total() == 1;
        assert repository.updateStatus(created.id(), "INTERVIEW").orElseThrow().status() == Application.Status.INTERVIEW;

        ApplicationRepository reloaded = new ApplicationRepository(dataFile, clock);
        assert reloaded.list().size() == 1;
        assert reloaded.list().getFirst().skills().size() == 3;
        assert reloaded.dashboard().responseRate() == 100;
        assert reloaded.delete(created.id());

        assert reloaded.list().isEmpty();
        assert reloaded.dashboard().total() == 0;
        List<ApplicationRepository.DeletedApplication> deleted = reloaded.recentlyDeleted();
        assert deleted.size() == 1;
        assert deleted.getFirst().application().id() == created.id();
        assert deleted.getFirst().application().status() == Application.Status.INTERVIEW;
        assert deleted.getFirst().deletedAt().equals(now);

        ApplicationRepository deletedReloaded = new ApplicationRepository(dataFile, clock);
        assert deletedReloaded.list().isEmpty();
        assert deletedReloaded.recentlyDeleted().size() == 1;
        assert deletedReloaded.restore(created.id()).orElseThrow().company().equals("Acme");
        assert deletedReloaded.list().size() == 1;
        assert deletedReloaded.recentlyDeleted().isEmpty();

        assert deletedReloaded.delete(created.id());
        assert deletedReloaded.permanentlyDelete(created.id());
        assert deletedReloaded.recentlyDeleted().isEmpty();
        assert !deletedReloaded.permanentlyDelete(created.id());

        ApplicationRepository permanentlyDeletedReloaded = new ApplicationRepository(dataFile, clock);
        assert permanentlyDeletedReloaded.list().isEmpty();
        assert permanentlyDeletedReloaded.recentlyDeleted().isEmpty();

        Application expiring = permanentlyDeletedReloaded.create(Map.of(
                "company", "Orbit", "role", "Backend Intern", "status", "SAVED"));
        assert permanentlyDeletedReloaded.delete(expiring.id());
        Clock afterRetention = Clock.fixed(now.plusSeconds(8L * 24 * 60 * 60), ZoneOffset.UTC);
        ApplicationRepository expiredReloaded = new ApplicationRepository(dataFile, afterRetention);
        assert expiredReloaded.list().isEmpty();
        assert expiredReloaded.recentlyDeleted().isEmpty();

        Application atlas = expiredReloaded.create(Map.of(
                "company", "Atlas", "role", "Platform Intern", "status", "APPLIED"));
        Application beacon = expiredReloaded.create(Map.of(
                "company", "Beacon", "role", "Frontend Intern", "status", "SAVED"));
        Application cedar = expiredReloaded.create(Map.of(
                "company", "Cedar", "role", "Backend Intern", "status", "APPLIED"));

        List<Application> updated = expiredReloaded.updateStatuses(List.of(atlas.id(), beacon.id()), "INTERVIEW").orElseThrow();
        assert updated.size() == 2;
        assert updated.stream().allMatch(application -> application.status() == Application.Status.INTERVIEW);

        assert expiredReloaded.updateStatuses(List.of(atlas.id(), 9999L), "OFFER").isEmpty();
        assert expiredReloaded.list().stream()
                .filter(application -> application.id() == atlas.id() || application.id() == beacon.id())
                .allMatch(application -> application.status() == Application.Status.INTERVIEW);
        assertIllegalArgument(() -> expiredReloaded.updateStatuses(List.of(atlas.id(), atlas.id()), "OFFER"));
        assertIllegalArgument(() -> expiredReloaded.updateStatuses(List.of(atlas.id()), "not-a-status"));

        List<ApplicationRepository.DeletedApplication> batchDeleted = expiredReloaded.deleteAll(List.of(atlas.id(), beacon.id())).orElseThrow();
        assert batchDeleted.size() == 2;
        assert batchDeleted.stream().allMatch(application -> application.deletedAt().equals(afterRetention.instant()));
        assert expiredReloaded.list().size() == 1;
        assert expiredReloaded.recentlyDeleted().size() == 2;

        assert expiredReloaded.deleteAll(List.of(cedar.id(), 9999L)).isEmpty();
        assert expiredReloaded.list().size() == 1;
        assert expiredReloaded.list().getFirst().id() == cedar.id();
        assert expiredReloaded.recentlyDeleted().size() == 2;
        assertIllegalArgument(() -> expiredReloaded.deleteAll(List.of()));
        assertIllegalArgument(() -> expiredReloaded.deleteAll(List.of(0L)));

        assert expiredReloaded.restoreAll(List.of(atlas.id(), 9999L)).isEmpty();
        assert expiredReloaded.list().size() == 1;
        assert expiredReloaded.recentlyDeleted().size() == 2;
        List<Application> batchRestored = expiredReloaded.restoreAll(List.of(atlas.id(), beacon.id())).orElseThrow();
        assert batchRestored.size() == 2;
        assert batchRestored.stream().allMatch(application -> application.status() == Application.Status.INTERVIEW);
        assert expiredReloaded.list().size() == 3;
        assert expiredReloaded.recentlyDeleted().isEmpty();
        assert expiredReloaded.restoreAll(List.of(atlas.id())).isEmpty();
        assertIllegalArgument(() -> expiredReloaded.restoreAll(List.of()));
        assertIllegalArgument(() -> expiredReloaded.restoreAll(List.of(0L)));

        List<ApplicationRepository.DeletedApplication> deletedAgain = expiredReloaded.deleteAll(List.of(atlas.id(), beacon.id())).orElseThrow();
        assert deletedAgain.size() == 2;
        assert expiredReloaded.permanentlyDeleteAll(List.of(atlas.id(), 9999L)).isEmpty();
        assert expiredReloaded.recentlyDeleted().size() == 2;
        List<ApplicationRepository.DeletedApplication> permanentlyDeleted = expiredReloaded.permanentlyDeleteAll(List.of(atlas.id(), beacon.id())).orElseThrow();
        assert permanentlyDeleted.size() == 2;
        assert expiredReloaded.recentlyDeleted().isEmpty();
        assert expiredReloaded.list().size() == 1;
        assert !expiredReloaded.permanentlyDeleteAll(List.of(atlas.id())).isPresent();
        assertIllegalArgument(() -> expiredReloaded.permanentlyDeleteAll(List.of()));
        assertIllegalArgument(() -> expiredReloaded.permanentlyDeleteAll(List.of(0L)));

        ApplicationRepository batchReloaded = new ApplicationRepository(dataFile, afterRetention);
        assert batchReloaded.list().size() == 1;
        assert batchReloaded.recentlyDeleted().isEmpty();

        notebookPagesCanBeEditedAndKeepATimeline(directory, now);
        rowsFromTheFirstVersionStillLoad(directory, now);
        System.out.println("ApplicationRepositoryTest passed");
    }

    private static void notebookPagesCanBeEditedAndKeepATimeline(Path directory, Instant now) throws Exception {
        Path dataFile = directory.resolve("notebook-pages.tsv");
        ApplicationRepository repository = new ApplicationRepository(dataFile, Clock.fixed(now, ZoneOffset.UTC));
        Application created = repository.create(Map.of(
                "company", "Northwind", "role", "Data Intern", "status", "SAVED",
                "link", "careers.northwind.example/jobs/42", "starred", "true",
                "skills", "a".repeat(80)));
        assert created.link().equals("https://careers.northwind.example/jobs/42");
        assert created.starred();
        assert created.history().size() == 1;
        assert created.history().getFirst().status() == Application.Status.SAVED;
        assert created.skills().getFirst().length() == 40;

        Instant later = now.plusSeconds(3L * 24 * 60 * 60);
        ApplicationRepository laterRepository = new ApplicationRepository(dataFile, Clock.fixed(later, ZoneOffset.UTC));
        Application edited = laterRepository.update(created.id(), Map.of(
                "status", "APPLIED", "notes", "Line one\nLine two\twith a tab",
                "nextStep", "Follow up with recruiter", "nextStepDate", "2026-09-30", "contact", "Sam (recruiter)")).orElseThrow();
        assert edited.status() == Application.Status.APPLIED;
        assert edited.company().equals("Northwind");
        assert edited.history().size() == 2;
        assert edited.history().get(1).at().equals(later);
        assert edited.updatedAt().equals(later);

        Application sameStatus = laterRepository.update(created.id(), Map.of("status", "APPLIED")).orElseThrow();
        assert sameStatus.history().size() == 2;

        ApplicationRepository reloaded = new ApplicationRepository(dataFile, Clock.fixed(later, ZoneOffset.UTC));
        Application saved = reloaded.list().getFirst();
        assert saved.notes().equals("Line one\nLine two\twith a tab");
        assert saved.nextStepDate().equals("2026-09-30");
        assert saved.contact().equals("Sam (recruiter)");
        assert saved.history().size() == 2;
        assert saved.starred();

        assertIllegalArgument(() -> reloaded.update(created.id(), Map.of("company", "  ")));
        assertIllegalArgument(() -> reloaded.update(created.id(), Map.of("link", "javascript:alert(1)")));
        assertIllegalArgument(() -> reloaded.update(created.id(), Map.of("nextStepDate", "next week")));
        assertIllegalArgument(() -> reloaded.update(created.id(), Map.of()));
        assert reloaded.update(9999L, Map.of("notes", "missing")).isEmpty();
        assert reloaded.list().getFirst().company().equals("Northwind");
    }

    private static void rowsFromTheFirstVersionStillLoad(Path directory, Instant now) throws Exception {
        Path dataFile = directory.resolve("first-version.tsv");
        Files.writeString(dataFile, String.join("\t", "7", "Legacy Co", "Backend Intern", "Toronto", "WaterlooWorks",
                "INTERVIEW", "2026-10-01", "Old note", "Java,SQL", "2026-09-01T10:00:00Z", "") + "\n");
        ApplicationRepository repository = new ApplicationRepository(dataFile, Clock.fixed(now, ZoneOffset.UTC));
        Application legacy = repository.list().getFirst();
        assert legacy.id() == 7;
        assert legacy.link().isEmpty();
        assert !legacy.starred();
        assert legacy.history().size() == 1;
        assert legacy.history().getFirst().status() == Application.Status.INTERVIEW;
        assert legacy.updatedAt().equals(legacy.createdAt());
        assert repository.create(Map.of("company", "Next", "role", "Intern")).id() == 8;
    }

    private static void assertIllegalArgument(ThrowingRunnable action) throws Exception {
        try {
            action.run();
            throw new AssertionError("Expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            // Expected: invalid batch input must make no changes.
        }
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
