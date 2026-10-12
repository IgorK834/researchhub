package dev.researchhub.ai.observability;

import dev.researchhub.auth.application.CurrentUserResolver;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workspaces/{workspaceId}/ai/usage")
public class WorkspaceAiUsageController {
    private final WorkspaceAiUsageService usage;
    private final CurrentUserResolver users;
    public WorkspaceAiUsageController(WorkspaceAiUsageService usage, CurrentUserResolver users) { this.usage=usage; this.users=users; }
    @GetMapping
    public ResponseEntity<WorkspaceAiUsageService.Summary> summary(@PathVariable UUID workspaceId, @RequestParam(defaultValue="30") int days) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store").body(usage.summary(workspaceId,users.requireCurrentUser().id(),days));
    }
}
