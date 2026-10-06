package dev.researchhub.document.api;

import dev.researchhub.document.application.DocumentVersionSummary;

import java.time.Instant;
import java.util.UUID;

/**
 * One entry in a document's history, without content.
 *
 * <p>{@code revision} is the committed document revision captured by this immutable snapshot.
 * Multiple named snapshots may capture the same revision. {@code createdBy} is its capturing
 * actor (null for scheduled system snapshots), with {@code actorName} preserving the display name.
 * Binary state is retained internally; the response exposes only verified checksum/epoch/sequence metadata.
 */
public record DocumentVersionSummaryResponse(
        UUID id,
        long revision,
        String reason,
        UUID restoredFromVersionId,
        UUID createdBy,
        String name,
        String actorName,
        String stateSha256,
        Long collaborationEpoch,
        Long collaborationSequence,
        Instant createdAt
) {

    static DocumentVersionSummaryResponse from(DocumentVersionSummary summary) {
        return new DocumentVersionSummaryResponse(summary.id(), summary.revision(), summary.reason(),
                summary.restoredFromVersionId(), summary.createdBy(), summary.name(), summary.actorName(), summary.stateSha256(), summary.collaborationEpoch(), summary.collaborationSequence(), summary.createdAt());
    }

}
