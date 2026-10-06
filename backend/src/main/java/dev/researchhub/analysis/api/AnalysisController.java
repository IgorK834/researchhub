package dev.researchhub.analysis.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.*;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/analyses")
public class AnalysisController {
    private final AnalysisService analyses;
    private final CurrentUserResolver users;
    private final ExecutionService executions;
    private final AnalysisReproductionService reproduction;
    public AnalysisController(AnalysisService analyses,CurrentUserResolver users,ExecutionService executions,AnalysisReproductionService reproduction) {
        this.analyses=analyses; this.users=users; this.executions=executions;this.reproduction=reproduction;
    }
    @PostMapping ResponseEntity<Analysis> create(@PathVariable UUID workspaceId,@RequestBody Create command) {
        var result=analyses.create(workspaceId,users.requireCurrentUser().id(),command);
        return ResponseEntity.created(URI.create("/api/workspaces/"+workspaceId+"/analyses/"+result.id()))
            .cacheControl(CacheControl.noStore()).body(result);
    }
    @GetMapping ResponseEntity<List<Analysis>> list(@PathVariable UUID workspaceId,@RequestParam(defaultValue="0") int offset) {
        return ok(analyses.list(workspaceId,users.requireCurrentUser().id(),offset));
    }
    @GetMapping("/{analysisId}") ResponseEntity<Analysis> find(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(analyses.find(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/plan") ResponseEntity<Analysis> plan(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(analyses.plan(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @GetMapping("/{analysisId}/plans") ResponseEntity<List<PlanAudit>> attempts(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(analyses.attempts(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/execute") ResponseEntity<ExecutionContracts.Execution> execute(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        var execution=executions.enqueue(workspaceId,users.requireCurrentUser().id(),analysisId);
        return ResponseEntity.accepted().location(URI.create("/api/workspaces/"+workspaceId+"/analyses/"+analysisId+"/executions/"+execution.id()))
            .cacheControl(CacheControl.noStore()).body(execution);
    }
    @GetMapping("/{analysisId}/executions") ResponseEntity<List<ExecutionContracts.Execution>> executions(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(executions.list(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}") ResponseEntity<ExecutionContracts.Execution> execution(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(executions.find(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/artifacts/{artifactId}") ResponseEntity<byte[]> artifact(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId,@PathVariable UUID artifactId) {
        var content=executions.artifact(workspaceId,users.requireCurrentUser().id(),analysisId,executionId,artifactId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.parseMediaType(content.artifact().mediaType()))
            .contentLength(content.artifact().sizeBytes()).header(HttpHeaders.CONTENT_DISPOSITION,
                ContentDisposition.attachment().filename(content.artifact().filename()).build().toString())
            .header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","sandbox; default-src 'none'").body(content.bytes());
    }
    @GetMapping("/{analysisId}/executions/{executionId}/record") ResponseEntity<ExecutionContracts.ExecutionRecord> record(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(executions.record(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @CostlyOperation(value = CostCategory.ANALYSIS, access = CostlyOperation.Access.EDIT)
    @PostMapping("/{analysisId}/executions/{executionId}/rerun") ResponseEntity<ReproductionContracts.RerunResult> rerun(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId,@RequestBody Map<String,Object> body) {
        if (body==null || !body.keySet().equals(Set.of("inputMode")) || !(body.get("inputMode") instanceof String mode))
            throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Only the original/latest input mode is accepted");
        ReproductionContracts.InputMode inputMode;
        try { inputMode=ReproductionContracts.InputMode.valueOf(mode); }
        catch (IllegalArgumentException invalid) { throw new dev.researchhub.shared.error.ApiException(dev.researchhub.shared.error.ApiErrorCode.VALIDATION_FAILED,"Use ORIGINAL or LATEST inputs"); }
        var command=new ReproductionContracts.Rerun(inputMode);
        var result=reproduction.rerun(workspaceId,users.requireCurrentUser().id(),analysisId,executionId,command);
        String location="/api/workspaces/"+workspaceId+"/analyses/"+result.analysisId();
        if (result.execution()!=null) location+="/executions/"+result.execution().id();
        return ResponseEntity.accepted().location(URI.create(location)).cacheControl(CacheControl.noStore()).body(result);
    }
    @GetMapping("/{analysisId}/origin") ResponseEntity<ReproductionContracts.Origin> origin(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(new ReproductionContracts.Origin(analyses.origin(workspaceId,users.requireCurrentUser().id(),analysisId).orElse(null)));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/provenance") ResponseEntity<ReproductionContracts.ComputationProvenance> provenance(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(reproduction.provenance(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    @GetMapping("/{analysisId}/executions/{executionId}/code") ResponseEntity<ReproductionContracts.SavedCode> code(
        @PathVariable UUID workspaceId,@PathVariable UUID analysisId,@PathVariable UUID executionId) {
        return ok(reproduction.code(workspaceId,users.requireCurrentUser().id(),analysisId,executionId));
    }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
