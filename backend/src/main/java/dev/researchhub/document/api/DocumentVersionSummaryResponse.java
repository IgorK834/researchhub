package dev.researchhub.document.api;

import dev.researchhub.document.application.DocumentVersionSummary;

import java.time.Instant;
import java.util.UUID;

/**
 * One entry in a document's history, without content.
 *
 * <p>{@code revision} is the document revision this snapshot captured. {@code reason} is one of {@code CREATED},
 * {@code MANUAL_SAVE}, {@code AUTOSAVE_CHECKPOINT}, or {@code RESTORE}; {@code restoredFromVersionId} is set only
 * for {@code RESTORE}. {@code createdBy} is who produced that revision.
 */
public record DocumentVersionSummaryResponse(
        UUID id,
        long revision,
        String reason,
        UUID restoredFromVersionId,
        UUID createdBy,
        Instant createdAt
) {

    static DocumentVersionSummaryResponse from(DocumentVersionSummary summary) {
        return new DocumentVersionSummaryResponse(summary.id(), summary.revision(), summary.reason(),
                summary.restoredFromVersionId(), summary.createdBy(), summary.createdAt());
    }

}
