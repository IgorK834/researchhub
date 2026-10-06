package dev.researchhub.audit.application;

import dev.researchhub.audit.infrastructure.PostgresReviewAudit;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Append-only comment contribution history. Authorization belongs to the calling review use case. */
@Service
@Profile("local")
public class ReviewAudit {
    public record Event(UUID id, UUID commentId, UUID replyId, UUID actorId, String actorName,
                        String action, String previousStatus, String status, Instant createdAt) {}
    private final PostgresReviewAudit store;
    public ReviewAudit(PostgresReviewAudit store) { this.store = store; }

    @Transactional
    public void record(UUID workspaceId, UUID documentId, Event event) {
        store.append(workspaceId, documentId, event);
    }

    @Transactional(readOnly = true)
    public List<Event> history(UUID workspaceId, UUID documentId, UUID commentId) {
        return store.history(workspaceId, documentId, commentId);
    }
}
