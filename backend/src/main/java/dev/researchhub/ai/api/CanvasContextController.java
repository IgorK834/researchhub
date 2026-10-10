package dev.researchhub.ai.api;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/documents/{documentId}/ai/contexts")
public class CanvasContextController {
    private final CanvasContextService contexts;private final CurrentUserResolver users;
    public CanvasContextController(CanvasContextService contexts,CurrentUserResolver users) { this.contexts=contexts;this.users=users; }
    @PostMapping ResponseEntity<Context> capture(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@RequestBody Capture request) {
        return response(contexts.capture(workspaceId,documentId,users.requireCurrentUser().id(),request));
    }
    @GetMapping("/{id}") ResponseEntity<Context> find(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID id) {
        return response(contexts.find(workspaceId,documentId,users.requireCurrentUser().id(),id));
    }
    @PostMapping("/{id}/resolve") ResponseEntity<Snapshot> resolve(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID id) {
        return response(contexts.resolve(workspaceId,documentId,users.requireCurrentUser().id(),id));
    }
    private static <T> ResponseEntity<T> response(T body) { return ResponseEntity.ok().header("Cache-Control","private, no-store").body(body); }
}
