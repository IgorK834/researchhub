package dev.researchhub.document.application;

import java.time.Instant;
import java.util.UUID;

/**
 * One snapshot in a document's history, without its content.
 *
 * <p>{@code reason} is the enum name, so {@code document.api} can render it without importing
 * {@code document.domain}. {@code restoredFromVersionId} is set only when {@code reason} is {@code RESTORE}.
 */
public record DocumentVersionSummary(
        UUID id,
        long revision,
        String reason,
        UUID restoredFromVersionId,
        UUID createdBy,
        Instant createdAt
) {
}
