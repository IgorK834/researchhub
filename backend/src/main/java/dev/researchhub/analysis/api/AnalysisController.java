package dev.researchhub.analysis.api;

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
    public AnalysisController(AnalysisService analyses,CurrentUserResolver users,ExecutionService executions) {
        this.analyses=analyses; this.users=users; this.executions=executions;
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
    @PostMapping("/{analysisId}/plan") ResponseEntity<Analysis> plan(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(analyses.plan(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
    @GetMapping("/{analysisId}/plans") ResponseEntity<List<PlanAudit>> attempts(@PathVariable UUID workspaceId,@PathVariable UUID analysisId) {
        return ok(analyses.attempts(workspaceId,users.requireCurrentUser().id(),analysisId));
    }
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
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
