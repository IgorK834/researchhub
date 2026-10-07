package dev.researchhub.ai.observability;

import dev.researchhub.auth.application.CurrentUserResolver;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/devtools/ai")
public class AiDiagnosticsController {
    private final AiDiagnosticsService service;
    private final CurrentUserResolver users;
    public AiDiagnosticsController(AiDiagnosticsService service,CurrentUserResolver users) { this.service=service; this.users=users; }
    @GetMapping public ResponseEntity<AiDiagnostics.Overview> overview(@PathVariable UUID workspaceId,@RequestParam(defaultValue="30") int days) {
        return noStore(service.overview(workspaceId,users.requireCurrentUser().id(),days));
    }
    @GetMapping("/traces/{id}") public ResponseEntity<AiDiagnostics.Detail> detail(@PathVariable UUID workspaceId,@PathVariable UUID id) {
        return noStore(service.detail(workspaceId,users.requireCurrentUser().id(),id));
    }
    private static <T> ResponseEntity<T> noStore(T value) { return ResponseEntity.ok().header("Cache-Control","private, no-store").body(value); }
}
