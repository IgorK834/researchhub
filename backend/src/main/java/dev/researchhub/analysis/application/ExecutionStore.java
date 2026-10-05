package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.ExecutionContracts.*;
import java.time.Instant;
import java.util.*;

/** Durable claims and append-only completed attempts; retries always receive a new execution identity. */
public interface ExecutionStore {
    Execution enqueue(UUID workspaceId, UUID analysisId, UUID callerId, Provenance provenance, Snapshot snapshot, Instant now);
    Optional<Execution> claim(Instant now);
    void complete(Execution claimed, Provenance provenance, Validated result, Failure failure, Diagnostics diagnostics, Instant now);
    void recoverInterrupted(Instant before, Instant now);
    Execution find(UUID workspaceId, UUID analysisId, UUID executionId);
    ExecutionRecord record(UUID workspaceId, UUID analysisId, UUID executionId);
    List<Execution> list(UUID workspaceId, UUID analysisId);
    ArtifactContent artifact(UUID workspaceId, UUID analysisId, UUID executionId, UUID artifactId);
}
