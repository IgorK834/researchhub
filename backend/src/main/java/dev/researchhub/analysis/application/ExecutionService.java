package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import java.io.IOException;
import java.time.Clock;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** Authorizes queueing, reauthorizes durable jobs and validates exact immutable bytes before isolated execution. */
@Service
@Profile("local")
public class ExecutionService {
    public static final int MAX_INPUT_BYTES=32*1024*1024, MAX_TOTAL_INPUT_BYTES=64*1024*1024;
    @org.springframework.beans.factory.annotation.Autowired
    private dev.researchhub.shared.observability.WorkMetrics metrics =
        new dev.researchhub.shared.observability.WorkMetrics(io.micrometer.core.instrument.Metrics.globalRegistry);
    private final WorkspaceAuthorizationService authorization;
    private final AnalysisService analyses;
    private final SourceService sources;
    private final ExecutionStore store;
    private final SandboxRunner runner;
    private final ObjectMapper json;
    private final ExecutionOutputValidator outputs;
    private final Clock clock;
    public ExecutionService(WorkspaceAuthorizationService authorization,AnalysisService analyses,SourceService sources,
                            ExecutionStore store,SandboxRunner runner,ObjectMapper json,Clock clock) {
        this.authorization=authorization; this.analyses=analyses; this.sources=sources; this.store=store;
        this.runner=runner; this.json=json; this.outputs=new ExecutionOutputValidator(json); this.clock=clock;
    }
    public Execution enqueue(UUID workspace,UUID caller,UUID analysisId) {
        return enqueue(workspace,caller,analysisId,null);
    }
    public Execution enqueue(UUID workspace,UUID caller,UUID analysisId,ReproductionContracts.Lineage lineage) {
        authorization.requireContentEditor(workspace,caller);
        var analysis=analyses.find(workspace,caller,analysisId);
        if (analysis.plan()==null) throw new ConflictException("Analysis must have an accepted plan before execution");
        var provenance=provenance(analysis,caller);
        if (lineage==null) lineage=analyses.origin(workspace,caller,analysisId).orElse(null);
        if (lineage!=null && lineage.requestedRuntime()!=null) provenance=new Provenance(provenance.planId(),provenance.planSha256(),
            provenance.codeSha256(),provenance.inputs(),lineage.requestedRuntime().imageId(),lineage.requestedRuntime().runtimeVersion());
        var snapshot=snapshot(analysis,caller);
        return store.enqueue(workspace,analysisId,caller,provenance,new Snapshot(snapshot.userPrompt(),snapshot.plan(),snapshot.inputs(),lineage),clock.instant());
    }
    public List<Execution> list(UUID workspace,UUID caller,UUID analysisId) {
        analyses.find(workspace,caller,analysisId); return store.list(workspace,analysisId);
    }
    public Execution find(UUID workspace,UUID caller,UUID analysisId,UUID executionId) {
        analyses.find(workspace,caller,analysisId); return store.find(workspace,analysisId,executionId);
    }
    public ArtifactContent artifact(UUID workspace,UUID caller,UUID analysisId,UUID executionId,UUID artifactId) {
        analyses.find(workspace,caller,analysisId); return store.artifact(workspace,analysisId,executionId,artifactId);
    }
    public ExecutionRecord record(UUID workspace,UUID caller,UUID analysisId,UUID executionId) {
        analyses.find(workspace,caller,analysisId);
        return store.record(workspace,analysisId,executionId);
    }
    void execute(Execution claimed) {
        String id=store.requestId(claimed.id());
        try (var ignored=dev.researchhub.shared.observability.CorrelationContext.open(
                id==null ? claimed.id().toString() : id,
                Map.of("jobId",claimed.id().toString(),"analysisId",claimed.analysisId().toString()))) {
            var sample=metrics.start(); boolean success=false;
            org.slf4j.LoggerFactory.getLogger(getClass()).atInfo().addKeyValue("event","analysis.execution.started")
                .log("Analysis execution started");
            try { success=executeObserved(claimed); }
            finally { metrics.finish(sample,dev.researchhub.shared.observability.WorkMetrics.Operation.ANALYSIS,success); }
        }
    }
    private boolean executeObserved(Execution claimed) {
        Provenance provenance=claimed.provenance(); Validated validated=null; Failure failure=null; Diagnostics diagnostics=null;
        long started=System.nanoTime();
        try {
            authorization.requireContentEditor(claimed.workspaceId(),claimed.requestedBy());
            Analysis analysis=analyses.find(claimed.workspaceId(),claimed.requestedBy(),claimed.analysisId());
            var expected=provenance(analysis,claimed.requestedBy());
            if (!provenance.planId().equals(expected.planId()) || !provenance.planSha256().equals(expected.planSha256())
                || !provenance.codeSha256().equals(expected.codeSha256()) || !provenance.inputs().equals(expected.inputs()))
                throw new ExecutionFailure(Failure.INPUT_CHANGED);
            List<SandboxRunner.Input> staged=new ArrayList<>();
            for (var input:provenance.inputs()) {
                var content=sources.openVersionContent(claimed.workspaceId(),claimed.requestedBy(),input.sourceId(),input.sourceVersionId());
                try (var stream=content.content()) {
                    byte[] bytes=stream.readNBytes(MAX_INPUT_BYTES+1);
                    if (bytes.length>MAX_INPUT_BYTES || bytes.length!=input.sizeBytes() || !ExecutionOutputValidator.sha256(bytes).equals(input.sha256()))
                        throw new ExecutionFailure(Failure.INPUT_CHANGED);
                    staged.add(new SandboxRunner.Input(input.sourceVersionId(),input.format(),bytes,input.sha256()));
                } catch (IOException unavailable) { throw new ExecutionFailure(Failure.INPUT_UNAVAILABLE); }
            }
            authorization.requireContentEditor(claimed.workspaceId(),claimed.requestedBy());
            analyses.find(claimed.workspaceId(),claimed.requestedBy(),claimed.analysisId());
            var run=runner.run(new SandboxRunner.Request(claimed.id(),analysis.planId(),analysis.plan().code().source(),staged,
                analysis.plan().outputs().stream().map(o -> new SandboxRunner.Output(o.name(),o.kind())).toList(),
                provenance.imageId()==null ? null : new ReproductionContracts.RuntimeIdentity(provenance.imageId(),provenance.runtimeVersion())));
            var stdout=ExecutionLogSanitizer.summarize(run.stdout()); var stderr=ExecutionLogSanitizer.summarize(run.stderr());
            diagnostics=new Diagnostics(run.exitCode(),run.timedOut(),stdout.text(),stderr.text(),
                run.stdoutTruncated() || stdout.truncated(),run.stderrTruncated() || stderr.truncated(),
                Math.max(0,(System.nanoTime()-started)/1_000_000),provenance.imageId()==null ? SandboxRunner.IMAGE : provenance.imageId());
            provenance=new Provenance(provenance.planId(),provenance.planSha256(),provenance.codeSha256(),provenance.inputs(),
                safeRuntime(run.imageId(),200),safeRuntime(run.runtimeVersion(),100));
            if (!run.successful()) {
                try { failure=Failure.valueOf(run.failureCode()); }
                catch (RuntimeException unsafe) { failure=Failure.EXECUTION_FAILED; }
            } else {
                try { validated=outputs.validate(analysis.plan(),run.files()); }
                catch (IllegalArgumentException invalid) { failure=Failure.EXECUTION_OUTPUT_INVALID; }
            }
            authorization.requireContentEditor(claimed.workspaceId(),claimed.requestedBy());
            analyses.find(claimed.workspaceId(),claimed.requestedBy(),claimed.analysisId());
        } catch (ExecutionFailure safe) { failure=safe.failure; }
        catch (ApiException revoked) { failure=Failure.ACCESS_REVOKED; }
        catch (java.io.UncheckedIOException unavailable) { failure=Failure.INPUT_UNAVAILABLE; }
        catch (RuntimeException unsafe) { failure=Failure.INTERNAL_ERROR; }
        store.complete(claimed,provenance,failure==null ? validated : null,failure,diagnostics,clock.instant());
        if (failure!=null) metrics.failure(dev.researchhub.shared.observability.WorkMetrics.Queue.ANALYSIS_EXECUTION);
        org.slf4j.LoggerFactory.getLogger(getClass()).atInfo().addKeyValue("event","analysis.execution.completed")
            .addKeyValue("outcome",failure==null ? "success" : "failure")
            .addKeyValue("errorCode",failure==null ? null : failure.name()).log("Analysis execution completed");
        return failure==null;
    }
    private Provenance provenance(Analysis analysis,UUID caller) {
        List<InputProvenance> inputs=new ArrayList<>(); long total=0;
        for (var input:analysis.inputs()) {
            var version=sources.findVersion(analysis.workspaceId(),caller,input.sourceId(),input.sourceVersionId());
            if (!Set.of("CSV","XLSX").contains(version.sourceType()) || !"READY".equals(version.status()))
                throw new ConflictException("Execution requires ready CSV or XLSX versions");
            total+=version.sizeBytes();
            if (version.sizeBytes()>MAX_INPUT_BYTES || total>MAX_TOTAL_INPUT_BYTES)
                throw new PayloadTooLargeException("Selected data exceeds the isolated execution input limit");
            inputs.add(new InputProvenance(input.sourceId(),input.sourceVersionId(),version.sourceType(),version.sizeBytes(),version.contentSha256()));
        }
        return new Provenance(analysis.planId(),ExecutionOutputValidator.sha256(json.writeValueAsString(analysis.plan())),
            ExecutionOutputValidator.sha256(analysis.plan().code().source()),inputs,null,null);
    }
    private Snapshot snapshot(Analysis analysis,UUID caller) {
        var audit=analyses.attempts(analysis.workspaceId(),caller,analysis.id()).stream()
            .filter(a -> a.id().equals(analysis.planId())).findFirst()
            .orElseThrow(() -> new IllegalStateException("Accepted planning audit is unavailable"));
        var inputs=audit.request().inputs().stream().map(inspected -> {
            var preview=inspected.preview();
            var sheets=analysis.plan().inputs().stream().filter(i -> i.sourceVersionId().equals(preview.sourceVersionId()))
                .map(selection -> new SelectedSheet(selection.sheetName(),selection.requiredColumns().stream().map(index -> {
                    String label=preview.sheets().stream().filter(s -> s.name().equals(selection.sheetName()))
                        .flatMap(s -> s.columns().stream()).filter(c -> c.index()==index).map(DatasetPreview.Column::name)
                        .findFirst().orElse(null);
                    return new SelectedColumn(index,label);
                }).toList())).toList();
            return new DatasetSnapshot(preview.sourceId(),preview.sourceVersionId(),preview.versionNumber(),preview.originalFilename(),
                preview.format(),preview.sizeBytes(),preview.contentSha256(),sheets);
        }).toList();
        return new Snapshot(analysis.userPrompt(),analysis.plan(),inputs);
    }
    private static String safeRuntime(String value,int max) {
        return value!=null && value.length()<=max && value.matches("[A-Za-z0-9._:+/@-]+") ? value : null;
    }
    private static final class ExecutionFailure extends RuntimeException {
        final Failure failure;
        ExecutionFailure(Failure failure) { super(failure.name()); this.failure=failure; }
    }
}
