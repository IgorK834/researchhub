package dev.researchhub.ai.api;

import dev.researchhub.security.application.CostlyOperation;
import dev.researchhub.security.application.CostCategory;
import dev.researchhub.ai.application.AuthoringContracts.*;
import dev.researchhub.ai.application.AuthoringService;
import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.document.application.DocumentDetail;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.*;
import java.time.Instant;
import java.util.UUID;

@RestController
@Profile("local")
@RequestMapping("/api/workspaces/{workspaceId}/documents/{documentId}/ai/suggestions")
public class AuthoringController {
    private final AuthoringService authoring; private final CurrentUserResolver users; private final ObjectMapper json;
    public AuthoringController(AuthoringService authoring, CurrentUserResolver users, ObjectMapper json) { this.authoring=authoring; this.users=users; this.json=json; }
    @CostlyOperation(value = CostCategory.LLM, access = CostlyOperation.Access.EDIT)
    @PostMapping ResponseEntity<Suggestion> suggest(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@RequestBody Command command) {
        return response(authoring.suggest(workspaceId,documentId,users.requireCurrentUser().id(),command));
    }
    @GetMapping("/{id}") ResponseEntity<Suggestion> find(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID id) {
        return response(authoring.find(workspaceId,documentId,users.requireCurrentUser().id(),id));
    }
    @PostMapping("/{id}/reject") ResponseEntity<Suggestion> reject(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID id) {
        return response(authoring.reject(workspaceId,documentId,users.requireCurrentUser().id(),id));
    }
    @PostMapping("/{id}/accept") ResponseEntity<Accepted> accept(@PathVariable UUID workspaceId,@PathVariable UUID documentId,@PathVariable UUID id,@RequestBody Accept command) {
        var result=authoring.accept(workspaceId,documentId,users.requireCurrentUser().id(),id,command);
        return response(new Accepted(result.eventId(),result.acceptedRevision(),DocumentView.from(result.document(),json)));
    }
    public record Accepted(UUID eventId,long acceptedRevision,DocumentView document) {}
    public record DocumentView(UUID id,String title,String contentFormat,long revision,Instant createdAt,Instant updatedAt,Instant archivedAt,JsonNode content) {
        static DocumentView from(DocumentDetail d,ObjectMapper json) {
            var s=d.summary(); return new DocumentView(s.id(),s.title(),s.contentFormat(),s.revision(),s.createdAt(),s.updatedAt(),s.archivedAt(),json.readTree(d.content()));
        }
    }
    private static <T> ResponseEntity<T> response(T body) { return ResponseEntity.ok().header("Cache-Control","private, no-store").body(body); }
}
