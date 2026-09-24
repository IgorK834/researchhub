package dev.researchhub.workspace.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.workspace.application.AddWorkspaceMemberCommand;
import dev.researchhub.workspace.application.WorkspaceMemberSummary;
import dev.researchhub.workspace.application.WorkspaceMembershipService;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Workspace membership endpoints.
 *
 * <table>
 *   <caption>Routes</caption>
 *   <tr><th>Endpoint</th><th>Who may call it</th></tr>
 *   <tr><td>{@code GET /api/workspaces/{workspaceId}/members}</td><td>Any member. Seeing who you work with is not a privilege.</td></tr>
 *   <tr><td>{@code POST /api/workspaces/{workspaceId}/members}</td><td>{@code MANAGE_MEMBERS}, so an owner. 201.</td></tr>
 *   <tr><td>{@code PATCH /api/workspaces/{workspaceId}/members/{userId}}</td><td>{@code MANAGE_MEMBERS}. 200.</td></tr>
 *   <tr><td>{@code DELETE /api/workspaces/{workspaceId}/members/{userId}}</td><td>{@code MANAGE_MEMBERS}. 204.</td></tr>
 * </table>
 *
 * <p>A non-member gets {@code 404 RESOURCE_NOT_FOUND} from all four, with the same detail as a workspace id
 * that does not exist. The roster is inside the boundary, so asking about it must not confirm that the
 * boundary is there. A member whose role is too low gets {@code 403} instead: they already know the workspace
 * exists.
 *
 * <p>All four require a session, granted by nothing here — the filter chain authenticates every request that
 * is not explicitly permitted, so an anonymous call is {@code 401} before this class runs. The three mutating
 * routes also need the CSRF header.
 *
 * <p>Separate from {@link WorkspaceController} because the resource is different: that class is about a
 * workspace, this one is about who is in it. Both resolve the caller through {@link CurrentUserResolver} and
 * never from the request body.
 *
 * <p>There is deliberately no endpoint here or anywhere that lists or searches users. An owner adds a
 * colleague by typing their full address; see {@code UserLookupService}.
 */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/members")
@Profile("local")
public class WorkspaceMemberController {

    private final WorkspaceMembershipService memberships;
    private final CurrentUserResolver currentUserResolver;

    public WorkspaceMemberController(WorkspaceMembershipService memberships,
                                     CurrentUserResolver currentUserResolver) {
        this.memberships = memberships;
        this.currentUserResolver = currentUserResolver;
    }

    /**
     * Everyone in the workspace, oldest membership first.
     *
     * <p>Available to every member, including on an archived workspace: archiving stops changes, not reading.
     */
    @GetMapping
    List<WorkspaceMemberResponse> list(@PathVariable UUID workspaceId) {
        return memberships.listMembers(workspaceId, currentUserId()).stream()
                .map(WorkspaceMemberResponse::from)
                .toList();
    }

    /**
     * Adds a registered user as an editor or viewer. Returns 201 with the new member.
     *
     * <p>An address with no active account is {@code 404} with one stable detail, the same answer whether it
     * is unknown, mistyped, or belongs to a disabled account. Somebody who is already a member is
     * {@code 409}. An archived workspace is {@code 409} and inserts nothing.
     */
    @PostMapping
    ResponseEntity<WorkspaceMemberResponse> add(@PathVariable UUID workspaceId,
                                                @Valid @RequestBody AddMemberRequest request) {
        WorkspaceMemberSummary added = memberships.addMember(workspaceId, currentUserId(),
                new AddWorkspaceMemberCommand(request.email(), request.role()));

        return ResponseEntity.status(HttpStatus.CREATED).body(WorkspaceMemberResponse.from(added));
    }

    /**
     * Changes one member's role. Returns 200 with the member as they now are.
     *
     * <p>Setting the role somebody already has succeeds and writes nothing. Demoting the last owner is
     * {@code 409}; promoting somebody else first is what makes it possible.
     */
    @PatchMapping("/{userId}")
    WorkspaceMemberResponse changeRole(@PathVariable UUID workspaceId, @PathVariable UUID userId,
                                      @Valid @RequestBody ChangeMemberRoleRequest request) {
        return WorkspaceMemberResponse.from(
                memberships.changeRole(workspaceId, currentUserId(), userId, request.role()));
    }

    /**
     * Removes one member's access. Returns 204.
     *
     * <p>Deletes one membership row and nothing else: the account remains, and so does every record of what
     * that person did. Removing the last owner is {@code 409}.
     *
     * <p>204 rather than a body, because there is nothing left to describe — and a response about a member
     * who is no longer one would be odd.
     */
    @DeleteMapping("/{userId}")
    ResponseEntity<Void> remove(@PathVariable UUID workspaceId, @PathVariable UUID userId) {
        memberships.removeMember(workspaceId, currentUserId(), userId);

        return ResponseEntity.noContent().build();
    }

    private UUID currentUserId() {
        return currentUserResolver.requireCurrentUser().id();
    }

}
