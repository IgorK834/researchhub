package dev.researchhub.audit.infrastructure;

import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.audit.application.ProductAudit.Event;
import dev.researchhub.shared.error.ResourceNotFoundException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.core.type.TypeReference;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class PostgresProductAudit {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public PostgresProductAudit(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }
    public void append(Event event) {
        jdbc.update("""
                INSERT INTO product_audit_events (id,workspace_id,actor_user_id,event_type,resource_type,resource_id,metadata,created_at)
                VALUES (?,?,?,?,?,?,?::jsonb,?)
                """, event.id(), event.workspaceId(), event.actorUserId(), event.eventType().name(), event.resourceType(),
                event.resourceId(), json.writeValueAsString(event.metadata()), Timestamp.from(event.createdAt()));
    }
    public List<Event> page(UUID workspace, int limit, UUID before) {
        if (before != null && jdbc.queryForObject("SELECT count(*) FROM product_audit_events WHERE workspace_id=? AND id=?",
                Integer.class, workspace, before) == 0) throw new ResourceNotFoundException("Audit cursor was not found");
        return jdbc.query("""
                SELECT * FROM product_audit_events WHERE workspace_id=?
                AND (?::uuid IS NULL OR (created_at,id) < (SELECT created_at,id FROM product_audit_events WHERE workspace_id=? AND id=?))
                ORDER BY created_at DESC,id DESC LIMIT ?
                """, (row, index) -> new Event(row.getObject("id", UUID.class), workspace, row.getObject("actor_user_id", UUID.class),
                ProductAudit.Type.valueOf(row.getString("event_type")), row.getString("resource_type"), row.getObject("resource_id", UUID.class),
                json.readValue(row.getString("metadata"), new TypeReference<Map<String, Object>>() {}), row.getTimestamp("created_at").toInstant()),
                workspace, before, workspace, before, limit);
    }
}
