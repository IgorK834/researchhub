package dev.researchhub.collaboration.infrastructure;

import dev.researchhub.collaboration.application.CollaborationContracts.*;
import dev.researchhub.document.application.DocumentWriteGuard;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
@Profile("local")
public class PostgresCollaborationStore implements DocumentWriteGuard {
    private final JdbcTemplate jdbc;
    public PostgresCollaborationStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void credential(String hash, Access access, Instant now) {
        jdbc.update("DELETE FROM collaboration_credentials WHERE expires_at <= ?", Timestamp.from(now));
        jdbc.update("INSERT INTO collaboration_credentials VALUES (?, ?, ?, ?, ?)",
                hash, access.workspaceId(), access.documentId(), access.userId(), Timestamp.from(access.expiresAt()));
    }
    public Access access(String hash, Instant now) {
        return jdbc.query("SELECT * FROM collaboration_credentials WHERE token_hash = ? AND expires_at > ?",
                (rs, row) -> new Access(rs.getObject("workspace_id", UUID.class), rs.getObject("document_id", UUID.class),
                        rs.getObject("user_id", UUID.class), rs.getTimestamp("expires_at").toInstant()), hash, Timestamp.from(now))
                .stream().findFirst().orElseThrow(() -> new ForbiddenException("Collaboration access denied"));
    }
    public Optional<StoredSnapshot> state(UUID documentId) {
        return jdbc.query("SELECT sequence, state, last_snapshot_id, state_sha256 FROM collaboration_documents WHERE document_id = ?",
                (rs, row) -> new StoredSnapshot(rs.getLong(1), rs.getBytes(2), rs.getObject(3, UUID.class), rs.getString(4)), documentId).stream().findFirst();
    }
    public void activate(UUID documentId) {
        jdbc.update("INSERT INTO collaboration_documents(document_id) VALUES (?) ON CONFLICT DO NOTHING", documentId);
    }
    public record StoredSnapshot(long sequence, byte[] state, UUID snapshotId, String stateSha256) {}

    public void recordHash(UUID documentId, String hash) {
        jdbc.update("UPDATE collaboration_documents SET state_sha256 = ? WHERE document_id = ?", hash, documentId);
    }

    public void save(UUID documentId, long sequence, byte[] state, UUID snapshotId, String hash) {
        if (jdbc.update("UPDATE collaboration_documents SET state = ?, sequence = sequence + 1, last_snapshot_id = ?, state_sha256 = ? WHERE document_id = ? AND sequence = ?",
                state, snapshotId, hash, documentId, sequence) != 1) throw new ConflictException("Collaboration state changed; reconnect");
    }
    @Override
    public void requireLegacyWrite(UUID documentId) {
        if (state(documentId).isPresent()) throw new ConflictException("This document requires the realtime editor");
    }
}
