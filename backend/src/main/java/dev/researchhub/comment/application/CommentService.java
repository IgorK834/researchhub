package dev.researchhub.comment.application;

import dev.researchhub.audit.application.ReviewAudit;
import dev.researchhub.comment.application.CommentContracts.*;
import dev.researchhub.comment.application.CommentContracts.Thread;
import dev.researchhub.comment.domain.CommentBody;
import dev.researchhub.comment.infrastructure.PostgresCommentStore;
import dev.researchhub.document.application.DocumentService;
import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.user.application.UserLookupService;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
@Profile("local")
public class CommentService {
    private final DocumentService documents;
    private final PostgresCommentStore store;
    private final ReviewAudit audit;
    private final CommentAnchors anchors;
    private final UserLookupService users;
    private final Clock clock;
    private final dev.researchhub.comment.infrastructure.PostgresCommentEvidence evidence;

    public CommentService(DocumentService documents, PostgresCommentStore store, ReviewAudit audit,
                          CommentAnchors anchors, UserLookupService users, Clock clock, dev.researchhub.comment.infrastructure.PostgresCommentEvidence evidence) {
        this.documents = documents; this.store = store; this.audit = audit;
        this.anchors = anchors; this.users = users; this.clock = clock;
        this.evidence = evidence;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Comment> list(UUID workspaceId, UUID actorId, UUID documentId) {
        Set<UUID> live = anchors.in(documents.findOne(workspaceId, actorId, documentId).content());
        var replies = store.repliesForDocument(workspaceId, documentId);
        var suggestions = evidence.forDocument(workspaceId, documentId);
        return store.list(workspaceId, documentId).stream().map(value -> enrich(value, live, replies.getOrDefault(value.id(), List.of()), suggestions.getOrDefault(value.id(), List.of()))).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Thread thread(UUID workspaceId, UUID actorId, UUID documentId, UUID commentId) {
        Set<UUID> live = anchors.in(documents.findOne(workspaceId, actorId, documentId).content());
        return new Thread(enrich(require(workspaceId, documentId, commentId), live), audit.history(workspaceId, documentId, commentId));
    }
    /** UUID supplied by the client makes a retry after a lost response idempotent. */
    @Transactional
    public Comment create(UUID workspaceId, UUID actorId, UUID documentId, Create command) {
        Set<UUID> live = anchors.in(documents.lockForReview(workspaceId, actorId, documentId).content());
        String body = body(command.body());
        Comment existing = store.find(workspaceId, documentId, command.id()).orElse(null);
        if (existing != null) {
            if (!existing.authorId().equals(actorId) || !existing.body().equals(body) || !existing.anchor().equals(command.anchor()))
                throw new ConflictException("This comment id is already in use");
            return enrich(existing, live);
        }
        if (!live.contains(command.anchor().id())) throw new ConflictException("The selected text is no longer available. Select text again.");
        Instant now = clock.instant();
        Comment value = new Comment(command.id(), workspaceId, documentId, actorId, name(actorId), body,
                "OPEN", command.anchor(), false, now, now, null, null, List.of(), List.of());
        store.create(value);
        event(value, actorId, value.authorName(), "CREATED", null, "OPEN", null, now);
        return value;
    }
    @Transactional
    public Comment reply(UUID workspaceId, UUID actorId, UUID documentId, UUID commentId, UUID replyId, String text) {
        Set<UUID> live = anchors.in(documents.lockForReview(workspaceId, actorId, documentId).content());
        Comment value = require(workspaceId, documentId, commentId);
        String body = body(text);
        Reply existing = store.findReply(workspaceId, documentId, commentId, replyId).orElse(null);
        if (existing != null) {
            if (!existing.authorId().equals(actorId) || !existing.body().equals(body)) throw new ConflictException("This reply id is already in use");
            return enrich(value, live);
        }
        if (!value.status().equals("OPEN")) throw new ConflictException("Reopen this thread before replying");
        Instant now = clock.instant();
        Reply reply = new Reply(replyId, actorId, name(actorId), body, now);
        store.reply(workspaceId, documentId, commentId, reply);
        event(value, actorId, reply.authorName(), "REPLIED", "OPEN", "OPEN", replyId, now);
        return enrich(require(workspaceId, documentId, commentId), live);
    }
    /** Row lock shared with saves/restore serializes transitions; repeated target status is a no-op. */
    @Transactional
    public Comment status(UUID workspaceId, UUID actorId, UUID documentId, UUID commentId, String status) {
        Set<UUID> live = anchors.in(documents.lockForReview(workspaceId, actorId, documentId).content());
        if (!Set.of("OPEN", "RESOLVED").contains(status)) throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Status must be OPEN or RESOLVED");
        Comment value = require(workspaceId, documentId, commentId);
        if (!value.status().equals(status)) {
            Instant now = clock.instant();
            store.status(workspaceId, documentId, commentId, status, actorId, now);
            event(value, actorId, name(actorId), status.equals("OPEN") ? "REOPENED" : "RESOLVED", value.status(), status, null, now);
        }
        return enrich(require(workspaceId, documentId, commentId), live);
    }
    private void event(Comment value, UUID actorId, String actorName, String action, String previous, String status, UUID replyId, Instant now) {
        audit.record(value.workspaceId(), value.documentId(), new ReviewAudit.Event(UUID.randomUUID(), value.id(), replyId,
                actorId, actorName, action, previous, status, now));
    }
    private Comment enrich(Comment value, Set<UUID> live) {
        return enrich(value, live, store.replies(value.workspaceId(), value.documentId(), value.id()),
                evidence.forDocument(value.workspaceId(), value.documentId()).getOrDefault(value.id(), List.of()));
    }
    private Comment enrich(Comment value, Set<UUID> live, List<Reply> replies, List<CommentEvidenceContracts.Suggestion> suggestions) {
        return new Comment(value.id(), value.workspaceId(), value.documentId(), value.authorId(), value.authorName(), value.body(),
                value.status(), value.anchor(), !live.contains(value.anchor().id()), value.createdAt(), value.updatedAt(),
                value.resolvedBy(), value.resolvedAt(), replies, suggestions);
    }
    private Comment require(UUID workspaceId, UUID documentId, UUID commentId) {
        return store.find(workspaceId, documentId, commentId).orElseThrow(() -> new ResourceNotFoundException("Comment was not found"));
    }
    private String name(UUID actorId) {
        return users.findAllByIds(List.of(actorId)).stream().findFirst().orElseThrow(() -> new ResourceNotFoundException("User was not found")).displayName();
    }
    private static String body(String text) {
        try { return new CommentBody(text).value(); }
        catch (IllegalArgumentException invalid) { throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage()); }
    }
}
