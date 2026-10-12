package dev.researchhub.workspace.infrastructure;

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
public class PostgresInvitationStore {
    public record Invitation(UUID id, UUID workspaceId, String email, String role, UUID invitedBy,
                             Instant expiresAt, Instant acceptedAt, Instant revokedAt, Instant createdAt) {}
    private final JdbcTemplate jdbc;
    public PostgresInvitationStore(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public void create(Invitation row, String hash) {
        jdbc.update("INSERT INTO workspace_invitation(id,workspace_id,email_normalized,role,token_hash,invited_by,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
            row.id(),row.workspaceId(),row.email(),row.role(),hash,row.invitedBy(),Timestamp.from(row.expiresAt()),Timestamp.from(row.createdAt()));
    }
    public Optional<Invitation> lockToken(String hash) {
        return jdbc.query("SELECT * FROM workspace_invitation WHERE token_hash=? FOR UPDATE",PostgresInvitationStore::map,hash).stream().findFirst();
    }
    public Optional<Invitation> lockId(UUID workspace, UUID id) {
        return jdbc.query("SELECT * FROM workspace_invitation WHERE workspace_id=? AND id=? FOR UPDATE",PostgresInvitationStore::map,workspace,id).stream().findFirst();
    }
    public List<Invitation> list(UUID workspace) {
        return jdbc.query("SELECT * FROM workspace_invitation WHERE workspace_id=? ORDER BY created_at DESC,id DESC",PostgresInvitationStore::map,workspace);
    }
    public void accept(UUID id, Instant now) { jdbc.update("UPDATE workspace_invitation SET accepted_at=? WHERE id=?",Timestamp.from(now),id); }
    public void revoke(UUID id, Instant now) { jdbc.update("UPDATE workspace_invitation SET revoked_at=? WHERE id=?",Timestamp.from(now),id); }
    private static Instant instant(ResultSet rs,String column) throws SQLException { var t=rs.getTimestamp(column); return t==null?null:t.toInstant(); }
    private static Invitation map(ResultSet rs,int index) throws SQLException {
        return new Invitation(rs.getObject("id",UUID.class),rs.getObject("workspace_id",UUID.class),rs.getString("email_normalized"),
            rs.getString("role"),rs.getObject("invited_by",UUID.class),instant(rs,"expires_at"),instant(rs,"accepted_at"),instant(rs,"revoked_at"),instant(rs,"created_at"));
    }
}
