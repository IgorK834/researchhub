package dev.researchhub.workspace.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.application.CreateWorkspaceCommand;
import dev.researchhub.workspace.application.UpdateWorkspaceCommand;
import dev.researchhub.workspace.application.WorkspaceService;
import dev.researchhub.workspace.application.WorkspaceSummary;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
 * Workspace endpoints.
 *
 * <table>
 *   <caption>Routes</caption>
 *   <tr><th>Endpoint</th><th>Answers</th></tr>
 *   <tr><td>{@code POST /api/workspaces}</td><td>201 with the new workspace; the caller becomes its OWNER</td></tr>
 *   <tr><td>{@code GET /api/workspaces}</td><td>The caller's active workspaces only</td></tr>
 *   <tr><td>{@code GET /api/workspaces/{workspaceId}}</td><td>One workspace, 404 unless the caller is a member</td></tr>
 *   <tr><td>{@code PATCH /api/workspaces/{workspaceId}}</td><td>Name and description. Needs {@code MANAGE_WORKSPACE}</td></tr>
 *   <tr><td>{@code POST /api/workspaces/{workspaceId}/archive}</td><td>Soft archive. Needs {@code MANAGE_WORKSPACE}</td></tr>
 * </table>
 *
 * <p>There is no {@code DELETE}. Archiving is the only way to retire a workspace, because the sources,
 * documents, and results that will hang off it have to stay traceable (docs/context.md sections 3.3 and
 * 3.4).
 *
 * <p>All of them require a session. Nothing here grants that: the filter chain in
 * {@code SecurityConfiguration} authenticates every request that is not explicitly permitted, so an
 * anonymous call is answered {@code 401 UNAUTHENTICATED} by the entry point before this class runs. The
 * route was already closed before it existed, which is the property
 * {@code AuthApiIntegrationTest.anUnlistedApiRouteIsAuthenticatedRatherThanPublic} guards.
 *
 * <p>The caller comes from {@link CurrentUserResolver}, never from the request. That resolver is the one
 * approved way into another module's user data from here, and it hands back a
 * {@code user.application.UserAccount} of which only {@code id()} is read — the allowed cross-module
 * dependency recorded in docs/development/backend-architecture.md.
 *
 * <p>Available in every product runtime; persistence dependencies must be configured at startup.
 */
@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceController.class);

    private final WorkspaceService workspaces;
    private final CurrentUserResolver currentUserResolver;

    public WorkspaceController(WorkspaceService workspaces, CurrentUserResolver currentUserResolver) {
        this.workspaces = workspaces;
        this.currentUserResolver = currentUserResolver;
    }

    /**
     * Creates a workspace owned by the caller.
     *
     * <p>Returns 201. The creator's {@code OWNER} membership is written in the same transaction as the
     * workspace, so a 201 means both rows exist.
     */
    @PostMapping
    ResponseEntity<WorkspaceResponse> create(@Valid @RequestBody CreateWorkspaceRequest request) {
        UUID callerId = currentUserId();

        WorkspaceSummary created = workspaces.create(
                new CreateWorkspaceCommand(request.name(), request.description(), callerId));

        log.info("event=workspace.created workspaceId={} userId={}", created.id(), callerId);
        return ResponseEntity.status(HttpStatus.CREATED).body(WorkspaceResponse.from(created));
    }

    /**
     * The caller's workspaces, newest first.
     *
     * <p>Scoped by membership, not filtered after the fact, and returns an empty list for a user who
     * belongs to none. There is no way to ask this endpoint for anyone else's workspaces, and no
     * repository method behind it that could answer such a question.
     */
    @GetMapping
    List<WorkspaceResponse> list() {
        return workspaces.listForMember(currentUserId()).stream()
                .map(WorkspaceResponse::from)
                .toList();
    }

    /**
     * One workspace, for a member of it.
     *
     * <p>A caller who is not a member gets {@code 404 RESOURCE_NOT_FOUND}, the same answer as a
     * workspace id that does not exist. That is deliberate: a 403 here would confirm the existence of
     * another team's workspace to anyone who can guess or has seen an id.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or there is no such workspace
     */
    @GetMapping("/{workspaceId}")
    WorkspaceResponse get(@PathVariable UUID workspaceId) {
        return WorkspaceResponse.from(workspaces.findForMember(workspaceId, currentUserId()));
    }

    /**
     * Changes the workspace's name and description. Requires {@code MANAGE_WORKSPACE}, so in practice an
     * owner.
     *
     * <p>Returns 200 with the updated workspace. An editor or viewer gets {@code 403 FORBIDDEN} — they
     * are members, so hiding the workspace from them would tell them nothing they do not know — while a
     * non-member gets the same {@code 404} as any other route. Editing an archived workspace is
     * {@code 409 CONFLICT}.
     *
     * <p>The body replaces both metadata fields; see {@link UpdateWorkspaceRequest}.
     */
    @PatchMapping("/{workspaceId}")
    WorkspaceResponse update(@PathVariable UUID workspaceId,
                             @Valid @RequestBody UpdateWorkspaceRequest request) {
        UUID callerId = currentUserId();

        WorkspaceSummary updated = workspaces.updateMetadata(workspaceId, callerId,
                new UpdateWorkspaceCommand(request.name(), request.description()));

        log.info("event=workspace.updated workspaceId={} userId={}", workspaceId, callerId);
        return WorkspaceResponse.from(updated);
    }

    /**
     * Archives the workspace. Requires {@code MANAGE_WORKSPACE}.
     *
     * <p>Returns 200 with the archived workspace, including {@code archivedAt}. Nothing is deleted: the
     * workspace and every membership row survive, and the workspace stays readable by id for its members
     * while dropping out of {@code GET /api/workspaces}.
     *
     * <p>A {@code POST} to a sub-resource rather than a {@code DELETE} on the workspace, because that is
     * what this is — a state change with a name, not a removal. It is idempotent: archiving twice returns
     * the same state and keeps the first {@code archivedAt}.
     */
    @PostMapping("/{workspaceId}/archive")
    WorkspaceResponse archive(@PathVariable UUID workspaceId) {
        UUID callerId = currentUserId();

        WorkspaceSummary archived = workspaces.archive(workspaceId, callerId);

        log.info("event=workspace.archived workspaceId={} userId={}", workspaceId, callerId);
        return WorkspaceResponse.from(archived);
    }

    /**
     * The authenticated caller's id.
     *
     * <p>Throws {@code 401 UNAUTHENTICATED} when the session is missing or its account is no longer
     * usable, so a disabled account loses access on its next request rather than when its session
     * happens to expire.
     */
    private UUID currentUserId() {
        return currentUserResolver.requireCurrentUser().id();
    }

}
