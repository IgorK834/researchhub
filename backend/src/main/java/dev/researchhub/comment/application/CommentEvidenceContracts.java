package dev.researchhub.comment.application;

import dev.researchhub.ai.application.EvidenceAssistanceService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** AI contribution identity is explicit; requestedBy identifies the human who invoked it, not its author. */
public final class CommentEvidenceContracts {
    private CommentEvidenceContracts() {}
    public record Suggestion(UUID id, UUID commentId, String kind, UUID requestedBy, String requestedByName,
                             String claim, EvidenceAssistanceService.Evidence evidence, Instant createdAt,
                             List<String> acceptedChunkIds) {}
}
