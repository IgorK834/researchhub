package dev.researchhub.source.application;

import java.time.Instant;
import java.util.UUID;
import java.util.List;

/**
 * A source's metadata, as the application exposes it.
 *
 * <p>No storage key. The key is how the service reaches the bytes, and nothing outside it has a use for one — a key
 * handed out would only invite somebody to treat it as a way in. {@code sourceType} and {@code status} are the enum
 * names, so a caller does not need {@code source.domain}.
 */
public record SourceSummary(
        UUID id,
        UUID workspaceId,
        String originalFilename,
        String displayName,
        String mediaType,
        String sourceType,
        long sizeBytes,
        String contentSha256,
        String status,
        String failureSummary,
        UUID uploadedBy,
        Instant createdAt,
        Instant updatedAt,
        UUID activeVersionId,
        int activeVersionNumber,
        SourceBibliography bibliography,
        List<String> tags,
        List<String> collections
) {
    public SourceSummary(UUID id, UUID workspaceId, String originalFilename, String displayName, String mediaType,
                         String sourceType, long sizeBytes, String contentSha256, String status, String failureSummary,
                         UUID uploadedBy, Instant createdAt, Instant updatedAt, UUID activeVersionId, int activeVersionNumber) {
        this(id, workspaceId, originalFilename, displayName, mediaType, sourceType, sizeBytes, contentSha256, status,
                failureSummary, uploadedBy, createdAt, updatedAt, activeVersionId, activeVersionNumber,
                SourceBibliography.from(dev.researchhub.source.domain.BibliographicMetadata.EMPTY), List.of(), List.of());
    }
}
