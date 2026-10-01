package dev.researchhub.source.application;

import java.time.Instant;
import java.util.UUID;

/** Public, storage-key-free metadata for one immutable upload. */
public record SourceVersionSummary(
        UUID id,
        UUID sourceId,
        UUID workspaceId,
        int versionNumber,
        String originalFilename,
        String mediaType,
        String sourceType,
        long sizeBytes,
        String contentSha256,
        String status,
        String failureSummary,
        UUID uploadedBy,
        Instant createdAt,
        Instant updatedAt,
        boolean active
) {}
