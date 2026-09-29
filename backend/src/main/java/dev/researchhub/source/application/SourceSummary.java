package dev.researchhub.source.application;

import java.time.Instant;
import java.util.UUID;

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
        Instant updatedAt
) {
}
