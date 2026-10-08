package dev.researchhub.collaboration.infrastructure;

import dev.researchhub.collaboration.application.CollaborationContracts.*;
import dev.researchhub.document.application.DocumentWriteGuard;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class PostgresCollaborationStore implements DocumentWriteGuard, dev.researchhub.document.application.DocumentSnapshotState {
    private final JdbcTemplate jdbc;
    public PostgresCollaborationStore(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void credential(String hash, Access access, Instant now) {
        jdbc.update("DELETE FROM collaboration_credentials WHERE expires_at <= ?", Timestamp.from(now));
        jdbc.update("INSERT INTO collaboration_credentials(token_hash,workspace_id,document_id,user_id,expires_at,epoch) VALUES (?, ?, ?, ?, ?, ?)",
                hash, access.workspaceId(), access.documentId(), access.userId(), Timestamp.from(access.expiresAt()),access.epoch());
    }
    public Access access(String hash, Instant now) {
        return jdbc.query("SELECT * FROM collaboration_credentials WHERE token_hash = ? AND expires_at > ?",
                (rs, row) -> new Access(rs.getObject("workspace_id", UUID.class), rs.getObject("document_id", UUID.class),
                        rs.getObject("user_id", UUID.class), rs.getTimestamp("expires_at").toInstant(),null,rs.getLong("epoch")), hash, Timestamp.from(now))
                .stream().findFirst().orElseThrow(() -> new ForbiddenException("Collaboration access denied"));
    }
    public Optional<StoredSnapshot> state(UUID documentId) {
        return jdbc.query("SELECT sequence, state, last_snapshot_id, state_sha256, epoch FROM collaboration_documents WHERE document_id = ?",
                (rs, row) -> new StoredSnapshot(rs.getLong(1), rs.getBytes(2), rs.getObject(3, UUID.class), rs.getString(4),rs.getLong(5)), documentId).stream().findFirst();
    }
    public void activate(UUID documentId) {
        jdbc.update("INSERT INTO collaboration_documents(document_id) VALUES (?) ON CONFLICT DO NOTHING", documentId);
    }
    public record StoredSnapshot(long sequence, byte[] state, UUID snapshotId, String stateSha256, long epoch) {}

    public void recordHash(UUID documentId, String hash) {
        jdbc.update("UPDATE collaboration_documents SET state_sha256 = ? WHERE document_id = ?", hash, documentId);
    }

    public void save(UUID documentId, long sequence, byte[] state, UUID snapshotId, String hash) {
        if (jdbc.update("UPDATE collaboration_documents SET state = ?, sequence = sequence + 1, last_snapshot_id = ?, state_sha256 = ? WHERE document_id = ? AND sequence = ?",
                state, snapshotId, hash, documentId, sequence) != 1) throw new ConflictException("Collaboration state changed; reconnect");
    }
    @Override
    public java.util.Optional<dev.researchhub.document.application.DocumentSnapshotState.State> snapshotState(UUID document) {
        return state(document).filter(s -> s.state()!=null).map(s -> {
            String verified=hash(s.state());
            if (s.stateSha256()==null) recordHash(document,verified);
            else if (!verified.equals(s.stateSha256())) throw new ConflictException("Collaboration snapshot integrity check failed");
            return new dev.researchhub.document.application.DocumentSnapshotState.State(s.state(),verified,s.epoch(),s.sequence());
        });
    }
    @Override
    public void restoreState(UUID document) {
        int changed=jdbc.update("UPDATE collaboration_documents SET epoch=epoch+1,state=NULL,sequence=0,last_snapshot_id=NULL,state_sha256=NULL WHERE document_id=?",document);
        // A credential may have been issued before a room was loaded. Retire that epoch too,
        // without activating legacy documents which never requested realtime access.
        if (changed==0) jdbc.update("INSERT INTO collaboration_documents(document_id,epoch) SELECT ?,1 WHERE EXISTS (SELECT 1 FROM collaboration_credentials WHERE document_id=?)",document,document);
    }
    private static String hash(byte[] bytes) {
        try { return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch(java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    @Override
    public void requireLegacyWrite(UUID documentId) {
        if (state(documentId).isPresent()) throw new ConflictException("This document requires the realtime editor");
    }
}
