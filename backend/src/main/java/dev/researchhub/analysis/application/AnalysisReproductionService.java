package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.analysis.application.ExecutionContracts.*;
import dev.researchhub.analysis.application.ReproductionContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.source.application.SourceService;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

/** Append-only reproduction workflow and log-free citation views for documents and AI consumers. */
@Service
public class AnalysisReproductionService {
    private final WorkspaceAuthorizationService authorization;
    private final AnalysisService analyses;
    private final ExecutionService executions;
    private final SourceService sources;
    private final DatasetPreviewService previews;
    private final ObjectMapper json;
    public AnalysisReproductionService(WorkspaceAuthorizationService authorization,AnalysisService analyses,
        ExecutionService executions,SourceService sources,DatasetPreviewService previews,ObjectMapper json) {
        this.authorization=authorization;this.analyses=analyses;this.executions=executions;this.sources=sources;this.previews=previews;this.json=json;
    }
    public RerunResult rerun(UUID workspace,UUID caller,UUID analysis,UUID execution,Rerun command) {
        authorization.requireContentEditor(workspace,caller);
        var record=executions.record(workspace,caller,analysis,execution);
        if (record.execution().status()!=Status.SUCCEEDED && record.execution().status()!=Status.FAILED)
            throw new ConflictException("Wait for this execution to finish before rerunning it");
        var intent=analyses.find(workspace,caller,analysis);
        List<VersionChange> changes=new ArrayList<>(); List<Input> inputs=new ArrayList<>();
        for (var original:record.snapshot().inputs()) {
            UUID selected=original.sourceVersionId(); int number=original.versionNumber();
            if (command.inputMode()==InputMode.LATEST) {
                var active=sources.findOne(workspace,caller,original.sourceId()); selected=active.activeVersionId();number=active.activeVersionNumber();
                if (!"READY".equals(active.status()) || !original.format().equals(active.sourceType()))
                    throw new ConflictException("The latest source must be ready and have the same dataset format; inspect it before creating a new analysis");
                var preview=previews.preview(workspace,original.sourceId(),selected,caller);
                for (var sheet:original.sheets()) {
                    var inspected=preview.sheets().stream().filter(s -> s.name().equals(sheet.name())).findFirst()
                        .orElseThrow(AnalysisReproductionService::selectionChanged);
                    for (var column:sheet.columns()) if (column.label()==null || inspected.columns().stream()
                        .noneMatch(c -> c.index()==column.index() && column.label().equals(c.name()))) throw selectionChanged();
                }
            }
            changes.add(new VersionChange(original.sourceId(),original.sourceVersionId(),original.versionNumber(),selected,number));
            // Retain the user's inspected selection. A fresh planner binds code to the new immutable filenames.
            var originalSelection=intent.inputs().stream()
                .filter(i -> i.sourceVersionId().equals(original.sourceVersionId())).findFirst().orElseThrow();
            inputs.add(new Input(original.sourceId(),selected,originalSelection.sheetName(),originalSelection.columns()));
        }
        var oldRuntime=record.execution().provenance();
        RuntimeIdentity runtime=command.inputMode()==InputMode.ORIGINAL && oldRuntime.imageId()!=null && oldRuntime.runtimeVersion()!=null
            ? new RuntimeIdentity(oldRuntime.imageId(),oldRuntime.runtimeVersion()) : null;
        var lineage=new Lineage(analysis,execution,command.inputMode(),changes,runtime);
        if (command.inputMode()==InputMode.ORIGINAL)
            return new RerunResult(analysis,executions.enqueue(workspace,caller,analysis,lineage),lineage,null);
        var derived=analyses.createDerived(workspace,caller,new Create(record.snapshot().userPrompt(),inputs),lineage);
        try {
            analyses.plan(workspace,caller,derived.id());
            return new RerunResult(derived.id(),executions.enqueue(workspace,caller,derived.id(),lineage),lineage,null);
        } catch (ApiException safe) {
            // Preserve the new request and its origin; never silently retry or return provider details.
            authorization.requireContentReader(workspace,caller);
            return new RerunResult(derived.id(),null,lineage,safe.code().name());
        } catch (RuntimeException unsafe) {
            authorization.requireContentReader(workspace,caller);
            return new RerunResult(derived.id(),null,lineage,ApiErrorCode.INTERNAL_ERROR.name());
        }
    }
    public ComputationProvenance provenance(UUID workspace,UUID caller,UUID analysis,UUID execution) {
        var record=executions.record(workspace,caller,analysis,execution);var run=record.execution();var snapshot=record.snapshot();
        String base="/api/workspaces/"+workspace+"/analyses/"+analysis+"/executions/"+execution;
        var links=new Links(base+"/provenance",base+"/record",base+"/code",
            "/app/workspaces/"+workspace+"/analyses/"+analysis+"?execution="+execution);
        List<OutputReference> references=new ArrayList<>();
        if (run.result()!=null) for (int i=0;i<run.result().outputs().size();i++) {
            var output=run.result().outputs().get(i);
            references.add(new OutputReference(output.name(),output.kind(),links.provenance(),links.details()+"#output-"+i,
                output.artifact()==null ? null : base+"/artifacts/"+output.artifact().id()));
        }
        // Schema v1 hash material excludes mutable current-source metadata and diagnostic logs.
        var material=new Execution(run.id(),run.analysisId(),run.workspaceId(),run.requestedBy(),run.attempt(),run.status(),
            run.createdAt(),run.startedAt(),run.finishedAt(),run.provenance(),run.result(),run.failureCode(),null);
        String hash=ExecutionOutputValidator.sha256(json.writeValueAsString(material));
        return new ComputationProvenance("1.0",workspace,analysis,execution,run.status(),snapshot.inputs(),snapshot.userPrompt(),
            snapshot.plan().summary(),snapshot.plan().warnings(),new CodeAccess("PYTHON",run.provenance().codeSha256(),links.code()),
            run.result(),record.charts(),references,run.finishedAt(),run.startedAt(),run.finishedAt(),run.provenance().runtimeVersion(),
            run.provenance().imageId(),snapshot.lineage(),hash,links);
    }
    public SavedCode code(UUID workspace,UUID caller,UUID analysis,UUID execution) {
        var record=executions.record(workspace,caller,analysis,execution);
        return new SavedCode(analysis,execution,"PYTHON",record.execution().provenance().codeSha256(),record.snapshot().plan().code().source());
    }
    private static ConflictException selectionChanged() {
        return new ConflictException("The latest sheets or column names/positions changed; inspect the new data and create a new analysis with reviewed selections");
    }
}
