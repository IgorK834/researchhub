package dev.researchhub.source.api;

import dev.researchhub.source.application.SourceSummary;

import java.time.Instant;
import java.util.UUID;

/** Public source metadata. The storage key is deliberately not part of the HTTP contract. */
public record SourceResponse(
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
        int activeVersionNumber
) {

    static SourceResponse from(SourceSummary source) {
        return new SourceResponse(source.id(), source.workspaceId(), source.originalFilename(), source.displayName(),
                source.mediaType(), source.sourceType(), source.sizeBytes(), source.contentSha256(), source.status(),
                source.failureSummary(), source.uploadedBy(), source.createdAt(), source.updatedAt(),
                source.activeVersionId(), source.activeVersionNumber());
    }

}
