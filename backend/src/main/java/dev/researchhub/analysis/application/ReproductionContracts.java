package dev.researchhub.analysis.application;

import java.time.Instant;
import java.util.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;

/** Explicit server-owned lineage and citation contracts; no client-supplied code or runtime options. */
public final class ReproductionContracts {
    private ReproductionContracts() {}
    public enum InputMode { ORIGINAL, LATEST }
    public record Rerun(InputMode inputMode) {
        public Rerun { if (inputMode==null) throw new IllegalArgumentException("Choose original or latest inputs"); }
    }
    public record VersionChange(UUID sourceId, UUID originalVersionId, int originalVersionNumber,
                                UUID selectedVersionId, int selectedVersionNumber) {}
    public record RuntimeIdentity(String imageId,String runtimeVersion) {
        public RuntimeIdentity {
            if (imageId==null || !imageId.matches("sha256:[a-f0-9]{64}") || runtimeVersion==null
                || !runtimeVersion.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) throw new IllegalArgumentException("Invalid saved runtime identity");
        }
    }
    public record Lineage(UUID originAnalysisId, UUID originExecutionId, InputMode inputMode,
                          List<VersionChange> versions, RuntimeIdentity requestedRuntime) {
        public Lineage { versions=List.copyOf(versions); }
        public boolean inputsChanged() { return versions.stream().anyMatch(v -> !v.originalVersionId().equals(v.selectedVersionId())); }
    }
    /** The derived analysis remains accessible even when planning/enqueueing fails. */
    public record RerunResult(UUID analysisId, Execution execution, Lineage lineage, String failureCode) {}
    public record Origin(Lineage lineage) {}
    public record Links(String provenance,String record,String code,String details) {}
    public record CodeAccess(String language,String sha256,String url) {}
    public record SavedCode(UUID analysisId,UUID executionId,String language,String sha256,String source) {}
    public record OutputReference(String name,AnalysisContracts.OutputKind kind,String provenanceUrl,String detailsUrl,String artifactUrl) {}
    public record ComputationProvenance(String schemaVersion, UUID workspaceId, UUID analysisId, UUID executionId,
        Status status, List<DatasetSnapshot> inputSources, String prompt, String planSummary, List<String> warnings,
        CodeAccess code, Result result, List<Chart> charts, List<OutputReference> outputReferences,
        Instant executionTimestamp, Instant startedAt, Instant finishedAt, String runtimeVersion, String imageId,
        Lineage lineage, String executionHash, Links links) {}
}
