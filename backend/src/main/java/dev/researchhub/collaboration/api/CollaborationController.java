package dev.researchhub.collaboration.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.collaboration.application.CollaborationService;
import dev.researchhub.collaboration.application.CollaborationContracts.*;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@Profile("local")
public class CollaborationController {
    private final CollaborationService service;
    private final CurrentUserResolver users;
    public CollaborationController(CollaborationService service, CurrentUserResolver users) { this.service = service; this.users = users; }
    @PostMapping("/api/workspaces/{workspaceId}/documents/{documentId}/collaboration/credential")
    public ResponseEntity<Credential> credential(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.issue(workspaceId, users.requireCurrentUser().id(), documentId));
    }
    @PostMapping("/api/workspaces/{workspaceId}/documents/{documentId}/collaboration/checkpoint")
    public dev.researchhub.document.application.DocumentDetail checkpoint(@PathVariable UUID workspaceId, @PathVariable UUID documentId) {
        return service.checkpoint(workspaceId, users.requireCurrentUser().id(), documentId);
    }
    public record AuthorizationRequest(String token, String room) {}
    @PostMapping("/internal/collaboration/authorize")
    public Access authorize(@RequestBody AuthorizationRequest request) { return service.authorize(request.token(), request.room()); }
    @PostMapping("/internal/collaboration/load")
    public State load(@RequestBody AuthorizationRequest request) { return service.load(request.token(), request.room()); }
    @PostMapping("/internal/collaboration/rooms/{room}/snapshot")
    public State snapshot(@PathVariable String room, @RequestBody Snapshot snapshot) { return service.save(room, snapshot); }
}
