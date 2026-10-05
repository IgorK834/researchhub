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
    public record Axis(String label, String unit, String scale) {}
    /** References persisted table columns; counts are derived by the validator, never supplied by generated code. */
    public record Series(String name, String tableName, String xColumn, String yColumn, String yTransform,
                         int rowCount, int pointCount) {}
    public record ChartMetadata(String title, Axis xAxis, Axis yAxis, List<Series> series) {
        public ChartMetadata { series=List.copyOf(series); }
    }
    public record ComputedOutput(OutputKind kind, String name, List<String> columns, List<List<Object>> rows,
                                 String text, Artifact artifact, ChartMetadata chart) {
        public ComputedOutput(OutputKind kind, String name, List<String> columns, List<List<Object>> rows,
                              String text, Artifact artifact) { this(kind,name,columns,rows,text,artifact,null); }
    }
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
    public record SelectedColumn(int index, String label) {}
    public record SelectedSheet(String name, List<SelectedColumn> columns) {
        public SelectedSheet { columns=List.copyOf(columns); }
    }
    public record DatasetSnapshot(UUID sourceId, UUID sourceVersionId, int versionNumber, String originalFilename,
                                  String format, long sizeBytes, String sha256, List<SelectedSheet> sheets) {
        public DatasetSnapshot { sheets=List.copyOf(sheets); }
    }
    /** Frozen at enqueue time and retained independently of runtime availability and the current source version. */
    public record Snapshot(String userPrompt, AnalysisContracts.Plan plan, List<DatasetSnapshot> inputs, ReproductionContracts.Lineage lineage) {
        public Snapshot(String userPrompt, AnalysisContracts.Plan plan, List<DatasetSnapshot> inputs) { this(userPrompt,plan,inputs,null); }
        public Snapshot { inputs=List.copyOf(inputs); }
    }
    /** IDs and code reference are bound by the server, never accepted from Python output. */
    public record Chart(String name, String title, Axis xAxis, Axis yAxis, List<Series> series,
                        UUID sourceAnalysisId, UUID executionId, String codeSha256, Artifact image,
                        boolean metadataAvailable) {}
    public record ExecutionRecord(String schemaVersion, Snapshot snapshot, Execution execution, List<Chart> charts) {
        public ExecutionRecord { charts=List.copyOf(charts); }
    }
}
