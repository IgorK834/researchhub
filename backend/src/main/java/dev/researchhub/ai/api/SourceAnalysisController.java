package dev.researchhub.ai.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.ai.application.SourceAnalysisService;
import dev.researchhub.ai.application.SourceAnalysisContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/ai/source-analyses")
public class SourceAnalysisController {
    private final SourceAnalysisService analyses; private final CurrentUserResolver users;
    public SourceAnalysisController(SourceAnalysisService analyses,CurrentUserResolver users) { this.analyses=analyses; this.users=users; }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.READ)
    @PostMapping("/comparisons") ResponseEntity<Analysis> compare(@PathVariable UUID workspaceId,@RequestBody Compare command) {
        return response(analyses.compare(workspaceId,users.requireCurrentUser().id(),command));
    }
    @GetMapping("/{id}") ResponseEntity<Analysis> find(@PathVariable UUID workspaceId,@PathVariable UUID id) {
        return response(analyses.find(workspaceId,users.requireCurrentUser().id(),id));
    }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.READ)
    @PostMapping("/{id}/disagreements") ResponseEntity<Analysis> disagreements(@PathVariable UUID workspaceId,@PathVariable UUID id,@RequestBody FollowUp command) {
        return response(analyses.disagreements(workspaceId,users.requireCurrentUser().id(),id,command));
    }
    private static ResponseEntity<Analysis> response(Analysis a) { return ResponseEntity.ok().header("Cache-Control","no-store").body(a); }
}
