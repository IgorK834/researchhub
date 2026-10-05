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
        authorization.requireContentEditor(workspace,caller);
        var analysis=analyses.find(workspace,caller,analysisId);
        if (analysis.plan()==null) throw new ConflictException("Analysis must have an accepted plan before execution");
        var provenance=provenance(analysis,caller);
        return store.enqueue(workspace,analysisId,caller,provenance,clock.instant());
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
    void execute(Execution claimed) {
        Provenance provenance=claimed.provenance(); Validated validated=null; Failure failure=null; Diagnostics diagnostics=null;
        long started=System.nanoTime();
        try {
            authorization.requireContentEditor(claimed.workspaceId(),claimed.requestedBy());
            Analysis analysis=analyses.find(claimed.workspaceId(),claimed.requestedBy(),claimed.analysisId());
            if (!provenance.equals(provenance(analysis,claimed.requestedBy()))) throw new ExecutionFailure(Failure.INPUT_CHANGED);
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
                analysis.plan().outputs().stream().map(o -> new SandboxRunner.Output(o.name(),o.kind())).toList()));
            diagnostics=new Diagnostics(run.exitCode(),run.timedOut(),boundedLog(run.stdout()),boundedLog(run.stderr()),
                run.stdoutTruncated() || run.stdout()!=null && run.stdout().length()>65536,
                run.stderrTruncated() || run.stderr()!=null && run.stderr().length()>65536,
                Math.max(0,(System.nanoTime()-started)/1_000_000),SandboxRunner.IMAGE);
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
    private static String safeRuntime(String value,int max) {
        return value!=null && value.length()<=max && value.matches("[A-Za-z0-9._:+/@-]+") ? value : null;
    }
    private static String boundedLog(String value) {
        return value==null ? "" : value.substring(0,Math.min(65536,value.length()));
    }
    private static final class ExecutionFailure extends RuntimeException {
        final Failure failure;
        ExecutionFailure(Failure failure) { super(failure.name()); this.failure=failure; }
    }
}
