package dev.researchhub.audit.infrastructure;

import dev.researchhub.audit.application.ReviewAudit.Event;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

@Repository
@Profile("local")
public class PostgresReviewAudit {
    private final JdbcTemplate jdbc;
    public PostgresReviewAudit(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void append(UUID workspaceId, UUID documentId, Event event) {
        jdbc.update("""
                INSERT INTO comment_audit_events
                (id, workspace_id, document_id, comment_id, reply_id, actor_id, actor_name,
                 action, previous_status, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, event.id(), workspaceId, documentId, event.commentId(), event.replyId(), event.actorId(),
                event.actorName(), event.action(), event.previousStatus(), event.status(), Timestamp.from(event.createdAt()));
    }

    public List<Event> history(UUID workspaceId, UUID documentId, UUID commentId) {
        return jdbc.query("""
                SELECT * FROM comment_audit_events WHERE workspace_id = ? AND document_id = ? AND comment_id = ?
                ORDER BY created_at, id
                """, (rs, row) -> new Event(rs.getObject("id", UUID.class), rs.getObject("comment_id", UUID.class),
                rs.getObject("reply_id", UUID.class), rs.getObject("actor_id", UUID.class), rs.getString("actor_name"),
                rs.getString("action"), rs.getString("previous_status"), rs.getString("status"),
                rs.getTimestamp("created_at").toInstant()), workspaceId, documentId, commentId);
    }
}
