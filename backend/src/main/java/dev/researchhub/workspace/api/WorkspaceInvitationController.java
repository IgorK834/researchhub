package dev.researchhub.workspace.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.workspace.application.WorkspaceInvitationService;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.PostgresInvitationStore.Invitation;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import dev.researchhub.shared.validation.EmailFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
public class WorkspaceInvitationController {
    public record CreateRequest(@NotBlank @Email(regexp=EmailFormat.PATTERN) @Size(max=320) String email, @NotNull WorkspaceRole role) {
        public CreateRequest { email = email == null ? null : email.strip(); }
    }
    public record CreatedResponse(Invitation invitation,String invitationPath) {
        @Override public String toString() { return "CreatedResponse[invitation="+invitation.id()+", invitationPath=REDACTED]"; }
    }
    private final WorkspaceInvitationService invitations;
    private final CurrentUserResolver users;
    public WorkspaceInvitationController(WorkspaceInvitationService invitations,CurrentUserResolver users) { this.invitations=invitations;this.users=users; }
    @PostMapping("/api/workspaces/{id}/invitations")
    public ResponseEntity<CreatedResponse> create(@PathVariable UUID id,@Valid @RequestBody CreateRequest request) {
        var created=invitations.create(id,users.requireCurrentUser().id(),request.email().strip(),request.role());
        return ResponseEntity.status(201).header("Cache-Control","no-store").body(new CreatedResponse(created.invitation(),"/invitations#"+created.token()));
    }
    @GetMapping("/api/workspaces/{id}/invitations")
    public List<Invitation> list(@PathVariable UUID id) { return invitations.list(id,users.requireCurrentUser().id()); }
    @DeleteMapping("/api/workspaces/{id}/invitations/{invitationId}")
    public ResponseEntity<Void> revoke(@PathVariable UUID id,@PathVariable UUID invitationId) {
        invitations.revoke(id,users.requireCurrentUser().id(),invitationId); return ResponseEntity.noContent().build();
    }
    @DeleteMapping("/api/workspaces/{id}/invitations")
    public ResponseEntity<Void> revokeByQuery(@PathVariable UUID id,@RequestParam UUID invitationId) {
        invitations.revoke(id,users.requireCurrentUser().id(),invitationId); return ResponseEntity.noContent().build();
    }
    @PostMapping("/api/invitations/{token}/accept")
    public ResponseEntity<Map<String,UUID>> accept(@PathVariable String token) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body(Map.of("workspaceId",invitations.accept(token,users.requireCurrentUser().id())));
    }
}
