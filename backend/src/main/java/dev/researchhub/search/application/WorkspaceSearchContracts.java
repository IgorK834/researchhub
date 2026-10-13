package dev.researchhub.search.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class WorkspaceSearchContracts {
    private WorkspaceSearchContracts() {}

    public enum Type { DOCUMENT, SOURCE, CONVERSATION, COMMENT, ANALYSIS }

    public record Result(Type type, UUID id, String title, String snippet, String location,
                         String sourceVersion, Instant updatedAt) {}

    public record Page(List<Result> items, String nextCursor) {
        public Page { items = List.copyOf(items); }
    }

    public record Cursor(Instant updatedAt, Type type, UUID id) {}
}
