package dev.researchhub.ai.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/ai")
public class GenerationController {
    private final ModelGateway gateway;
    private final CurrentUserResolver users;
    public GenerationController(ModelGateway gateway, CurrentUserResolver users) { this.gateway = gateway; this.users = users; }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.READ)
    @PostMapping("/generations")
    ResponseEntity<GeneratedResponse> generate(@PathVariable UUID workspaceId, @RequestBody Command command) {
        return noStore(gateway.generate(workspaceId, users.requireCurrentUser().id(), command));
    }
    @GetMapping("/generations/{requestId}")
    ResponseEntity<GeneratedResponse> find(@PathVariable UUID workspaceId, @PathVariable UUID requestId) {
        return noStore(gateway.find(workspaceId, users.requireCurrentUser().id(), requestId));
    }
    @GetMapping("/model")
    ResponseEntity<ModelMetadata> model(@PathVariable UUID workspaceId) {
        return noStore(gateway.modelMetadata(workspaceId, users.requireCurrentUser().id()));
    }
    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().header("Cache-Control", "private, no-store").body(body); }
}
