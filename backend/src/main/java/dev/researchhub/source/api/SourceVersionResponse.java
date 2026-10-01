package dev.researchhub.source.api;

import dev.researchhub.source.application.SourceVersionSummary;

import java.time.Instant;
import java.util.UUID;

/** Exact uploaded-version metadata; storage keys are never public. */
public record SourceVersionResponse(UUID id, UUID sourceId, UUID workspaceId, int versionNumber,
                                    String originalFilename, String mediaType, String sourceType, long sizeBytes,
                                    String contentSha256, String status, String failureSummary, UUID uploadedBy,
                                    Instant createdAt, Instant updatedAt, boolean active) {
    static SourceVersionResponse from(SourceVersionSummary version) {
        return new SourceVersionResponse(version.id(), version.sourceId(), version.workspaceId(),
                version.versionNumber(), version.originalFilename(), version.mediaType(), version.sourceType(),
                version.sizeBytes(), version.contentSha256(), version.status(), version.failureSummary(),
                version.uploadedBy(), version.createdAt(), version.updatedAt(), version.active());
    }
}
