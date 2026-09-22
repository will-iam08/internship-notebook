package com.coopcompass;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public record Application(
        long id,
        String company,
        String role,
        String location,
        String source,
        Status status,
        String deadline,
        String notes,
        List<String> skills,
        Instant createdAt,
        String link,
        String contact,
        String nextStep,
        String nextStepDate,
        boolean starred,
        List<StatusChange> history,
        Instant updatedAt
) {
    public Application {
        skills = List.copyOf(skills);
        history = List.copyOf(history);
    }

    public enum Status {
        SAVED("Saved"), APPLIED("Applied"), INTERVIEW("Interview"), OFFER("Offer"), REJECTED("Rejected");

        private final String label;

        Status(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }

        public static Status from(String value) {
            if (value == null || value.isBlank()) return SAVED;
            for (Status status : values()) {
                if (status.name().equalsIgnoreCase(value) || status.label.equalsIgnoreCase(value)) return status;
            }
            throw new IllegalArgumentException("Choose a valid application status.");
        }
    }

    /** One entry in an application's timeline: the stage it moved to and when. */
    public record StatusChange(Status status, Instant at) { }

    /**
     * Returns a copy in the new stage. The timeline only grows when the stage actually changes,
     * so re-saving the same status does not create duplicate history entries.
     */
    public Application withStatus(Status nextStatus, Instant at) {
        if (nextStatus == status) return this;
        List<StatusChange> nextHistory = new ArrayList<>(history);
        nextHistory.add(new StatusChange(nextStatus, at));
        return new Application(id, company, role, location, source, nextStatus, deadline, notes, skills, createdAt,
                link, contact, nextStep, nextStepDate, starred, nextHistory, at);
    }
}
