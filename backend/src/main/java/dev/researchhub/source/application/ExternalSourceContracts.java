package dev.researchhub.source.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** External discoveries have their own identity and never masquerade as uploaded source versions. */
public final class ExternalSourceContracts {
    private ExternalSourceContracts() {}
    public enum EvidenceType { EXTERNAL_WEB }
    public record Availability(boolean available, String provider) {}
    public record SearchCommand(String query, Boolean externalSearchEnabled) {}
    public record Result(UUID id, String title, String url, String snippet) {}
    public record Search(UUID id, UUID workspaceId, EvidenceType evidenceType, String provider,
                         String query, UUID searchedBy, Instant searchedAt, List<Result> results) {
        public Search { results = List.copyOf(results); }
    }
    public record RecordCommand(UUID searchId, UUID resultId) {}
    public record Reference(UUID id, UUID workspaceId, EvidenceType evidenceType, String provider,
                            String query, UUID searchId, UUID resultId, String title, String url, String snippet,
                            UUID searchedBy, Instant discoveredAt, UUID recordedBy, Instant recordedAt,
                            String snapshotSha256) {}
    public record Page(List<Reference> items, long totalElements, int page, int size, boolean hasNext) {}
}
