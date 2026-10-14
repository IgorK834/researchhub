package dev.researchhub.comment.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Explicit review/v1 API. Offsets are never stored. Quote is historical context, not a search key. */
public final class CommentContracts {
    private CommentContracts() {}

    public record Anchor(String strategy, UUID id, String quote) {
        public Anchor {
            if (!"TEXT_MARK_V1".equals(strategy) || id == null || quote == null
                    || quote.isBlank() || quote.length() > 2000) {
                throw new IllegalArgumentException("A TEXT_MARK_V1 anchor with an id and a selection of 1–2000 characters is required");
            }
        }
    }
    public record Mention(UUID userId, String displayLabel, int start, int end, boolean available) {
        public Mention(UUID userId,String displayLabel,int start,int end) {this(userId,displayLabel,start,end,true);}
    }
    public record Create(UUID id, String body, Anchor anchor, List<Mention> mentions) {
        public Create(UUID id,String body,Anchor anchor) {this(id,body,anchor,List.of());}
    }
    public record Reply(UUID id, UUID authorId, String authorName, String body, Instant createdAt, List<Mention> mentions) {
        public Reply(UUID id,UUID authorId,String authorName,String body,Instant createdAt) {this(id,authorId,authorName,body,createdAt,List.of());}
    }
    public record Comment(UUID id, UUID workspaceId, UUID documentId, UUID authorId, String authorName,
                          String body, String status, Anchor anchor, boolean orphaned,
                          Instant createdAt, Instant updatedAt, UUID resolvedBy, Instant resolvedAt,
                          List<Reply> replies, List<CommentEvidenceContracts.Suggestion> aiSuggestions, long revision, List<Mention> mentions) {}
    public record Thread(Comment comment, List<dev.researchhub.audit.application.ReviewAudit.Event> events) {}
}
