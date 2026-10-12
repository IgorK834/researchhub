package dev.researchhub.user.application;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Restore authority outside PostgreSQL product backups. Contains no identity lookup values or content. */
public interface ErasureLedger {
    record Entry(String schemaVersion, UUID requestId, UUID actorId, List<UUID> workspaceIds, String policyVersion, Instant requestedAt) {}
    void record(Entry entry) throws IOException;
}
