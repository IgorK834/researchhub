package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.OutputKind;
import java.time.Instant;
import java.util.*;

/** Runtime results are stored separately from model candidates and accepted planning intent. */
public final class ExecutionContracts {
    private ExecutionContracts() {}
    public enum Status { QUEUED, RUNNING, SUCCEEDED, FAILED }
    public enum Failure {
        SANDBOX_DISABLED, SANDBOX_UNAVAILABLE, SANDBOX_INPUT_INVALID, SANDBOX_CLEANUP_FAILED, EXECUTION_TIMEOUT, EXECUTION_FAILED,
        EXECUTION_OUTPUT_INVALID, EXECUTION_OUTPUT_LIMIT, EXECUTION_RESOURCE_LIMIT,
        INPUT_UNAVAILABLE, INPUT_CHANGED, ACCESS_REVOKED, EXECUTION_INTERRUPTED, INTERNAL_ERROR
    }
    public record InputProvenance(UUID sourceId, UUID sourceVersionId, String format, long sizeBytes, String sha256) {}
    public record Provenance(UUID planId, String planSha256, String codeSha256, List<InputProvenance> inputs,
                             String imageId, String runtimeVersion) {
        public Provenance { inputs=List.copyOf(inputs); }
    }
    public record Artifact(UUID id, String filename, String mediaType, long sizeBytes, String sha256) {}
    public record ComputedOutput(OutputKind kind, String name, List<String> columns, List<List<Object>> rows,
                                 String text, Artifact artifact) {}
    public record Result(String schemaVersion, List<ComputedOutput> outputs) {
        public Result { outputs=List.copyOf(outputs); }
    }
    public record Diagnostics(Integer exitCode, boolean timedOut, String stdout, String stderr,
                              boolean stdoutTruncated, boolean stderrTruncated, long durationMillis, String configuredImage) {}
    public record Execution(UUID id, UUID analysisId, UUID workspaceId, UUID requestedBy, int attempt, Status status,
                            Instant createdAt, Instant startedAt, Instant finishedAt, Provenance provenance,
                            Result result, Failure failureCode, Diagnostics diagnostics) {}
    public record ArtifactContent(Artifact artifact, byte[] bytes) {}
    public record Validated(Result result, Map<UUID,byte[]> artifacts) {}
}
