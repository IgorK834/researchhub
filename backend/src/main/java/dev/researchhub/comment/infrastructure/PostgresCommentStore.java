package dev.researchhub.comment.infrastructure;

import dev.researchhub.comment.application.CommentContracts.*;
import dev.researchhub.shared.error.ConflictException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class PostgresCommentStore {
    private final JdbcTemplate jdbc;
    public PostgresCommentStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<Comment> list(UUID workspaceId, UUID documentId) {
        return jdbc.query("SELECT * FROM document_comments WHERE workspace_id = ? AND document_id = ? ORDER BY created_at, id",
                (rs, row) -> comment(rs), workspaceId, documentId);
    }
    public Optional<Comment> find(UUID workspaceId, UUID documentId, UUID id) {
        return jdbc.query("SELECT * FROM document_comments WHERE workspace_id = ? AND document_id = ? AND id = ?",
                (rs, row) -> comment(rs), workspaceId, documentId, id).stream().findFirst();
    }
    public void create(Comment value) {
        int inserted = jdbc.update("""
                INSERT INTO document_comments (id, workspace_id, document_id, author_id, author_name, body,
                 status, anchor_id, anchor_quote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?) ON CONFLICT DO NOTHING
                """, value.id(), value.workspaceId(), value.documentId(), value.authorId(), value.authorName(),
                value.body(), value.anchor().id(), value.anchor().quote(), Timestamp.from(value.createdAt()), Timestamp.from(value.updatedAt()));
        if (inserted != 1) throw new ConflictException("This comment id or anchor is already in use");
    }
    public List<Reply> replies(UUID workspaceId, UUID documentId, UUID commentId) {
        return jdbc.query("""
                SELECT * FROM comment_replies WHERE workspace_id = ? AND document_id = ? AND comment_id = ? ORDER BY created_at, id
                """, (rs, row) -> new Reply(rs.getObject("id", UUID.class), rs.getObject("author_id", UUID.class),
                rs.getString("author_name"), rs.getString("body"), rs.getTimestamp("created_at").toInstant()),
                workspaceId, documentId, commentId);
    }
    /** Batched projection for a panel refresh; one query regardless of thread count. */
    public java.util.Map<UUID, List<Reply>> repliesForDocument(UUID workspaceId, UUID documentId) {
        java.util.Map<UUID, List<Reply>> result = new java.util.HashMap<>();
        jdbc.query("SELECT * FROM comment_replies WHERE workspace_id = ? AND document_id = ? ORDER BY created_at, id",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID commentId = rs.getObject("comment_id", UUID.class);
                    result.computeIfAbsent(commentId, ignored -> new java.util.ArrayList<>()).add(new Reply(
                            rs.getObject("id", UUID.class), rs.getObject("author_id", UUID.class), rs.getString("author_name"),
                            rs.getString("body"), rs.getTimestamp("created_at").toInstant()));
                }, workspaceId, documentId);
        return result;
    }
    public Optional<Reply> findReply(UUID workspaceId, UUID documentId, UUID commentId, UUID replyId) {
        return replies(workspaceId, documentId, commentId).stream().filter(reply -> reply.id().equals(replyId)).findFirst();
    }
    public void reply(UUID workspaceId, UUID documentId, UUID commentId, Reply value) {
        int inserted = jdbc.update("""
                INSERT INTO comment_replies (id, workspace_id, document_id, comment_id, author_id, author_name, body, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
                """, value.id(), workspaceId, documentId, commentId, value.authorId(), value.authorName(), value.body(), Timestamp.from(value.createdAt()));
        if (inserted != 1) throw new ConflictException("This reply id is already in use");
        jdbc.update("UPDATE document_comments SET updated_at = ? WHERE workspace_id = ? AND document_id = ? AND id = ?",
                Timestamp.from(value.createdAt()), workspaceId, documentId, commentId);
    }
    public void status(UUID workspaceId, UUID documentId, UUID id, String status, UUID actor, Instant now) {
        boolean resolved = status.equals("RESOLVED");
        jdbc.update("""
                UPDATE document_comments SET status = ?, updated_at = ?, resolved_by = ?, resolved_at = ?
                WHERE workspace_id = ? AND document_id = ? AND id = ?
                """, status, Timestamp.from(now), resolved ? actor : null, resolved ? Timestamp.from(now) : null,
                workspaceId, documentId, id);
    }
    private static Comment comment(ResultSet rs) throws SQLException {
        Timestamp resolved = rs.getTimestamp("resolved_at");
        return new Comment(rs.getObject("id", UUID.class), rs.getObject("workspace_id", UUID.class),
                rs.getObject("document_id", UUID.class), rs.getObject("author_id", UUID.class), rs.getString("author_name"),
                rs.getString("body"), rs.getString("status"), new Anchor("TEXT_MARK_V1", rs.getObject("anchor_id", UUID.class),
                rs.getString("anchor_quote")), false, rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant(),
                rs.getObject("resolved_by", UUID.class), resolved == null ? null : resolved.toInstant(), List.of(), List.of());
    }
}
