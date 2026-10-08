package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import dev.researchhub.workspace.infrastructure.WorkspaceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * The one place that decides whether a caller may touch a workspace.
 *
 * <p>Every endpoint that names a {@code workspaceId} goes through here, so the rule cannot be applied
 * in one controller and forgotten in the next. docs/context.md section 32 requires authorization to be
 * enforced server-side; the frontend hiding a button is not access control.
 *
 * <p>The two answers are deliberately different in kind:
 *
 * <ul>
 *   <li><strong>Not a member: 404.</strong> {@link #requireMember} throws
 *       {@link ResourceNotFoundException} with the same message a genuinely missing workspace produces.
 *       A 403 would confirm that another team's workspace exists, turning any endpoint into an
 *       existence oracle for ids someone can guess or has seen in a URL. Whether the workspace exists
 *       is itself information only its members are entitled to.
 *   <li><strong>A member without the capability: 403.</strong> {@link #requireCapability} throws
 *       {@link ForbiddenException}. The caller already knows the workspace exists, so hiding it would
 *       tell them nothing and would misdescribe the failure. They need to know their role is too low,
 *       not that the thing they are looking at vanished.
 * </ul>
 *
 * <p>Available in every product runtime; persistence dependencies must be configured at startup.
 */
@Service
public class WorkspaceAuthorizationService {

    /**
     * One message for "you are not a member" and for "no such workspace".
     *
     * <p>They must read identically, or the difference between the two responses is the answer to a
     * question the caller is not allowed to ask.
     */
    static final String WORKSPACE_NOT_FOUND = "Workspace was not found";

    private static final Logger log = LoggerFactory.getLogger(WorkspaceAuthorizationService.class);

    private final WorkspaceMemberRepository members;
    private final WorkspaceRepository workspaces;

    public WorkspaceAuthorizationService(WorkspaceMemberRepository members,
                                         WorkspaceRepository workspaces) {
        this.members = members;
        this.workspaces = workspaces;
    }

    /**
     * Asserts that {@code userId} is a member of {@code workspaceId} and returns the role held.
     *
     * @throws ResourceNotFoundException when the caller has no membership, whether or not the
     *                                   workspace exists
     */
    @Transactional(readOnly = true)
    public WorkspaceRole requireMember(UUID workspaceId, UUID userId) {
        return members.findByWorkspaceIdAndUserId(workspaceId, userId)
                .map(WorkspaceMemberEntity::getRole)
                .orElseThrow(() -> {
                    log.debug("event=workspace.access.denied reason=not_a_member workspaceId={} userId={}",
                            workspaceId, userId);
                    return new ResourceNotFoundException(WORKSPACE_NOT_FOUND);
                });
    }

    /**
     * Asserts that {@code userId} is a member of {@code workspaceId} <em>and</em> that the role held
     * carries {@code capability}. Returns the role, so a caller that also wants to report it does not
     * need a second query.
     *
     * @throws ResourceNotFoundException when the caller is not a member
     * @throws ForbiddenException        when the caller is a member whose role does not allow this
     */
    @Transactional(readOnly = true)
    public WorkspaceRole requireCapability(UUID workspaceId, UUID userId, WorkspaceCapability capability) {
        WorkspaceRole role = requireMember(workspaceId, userId);

        if (!role.allows(capability)) {
            log.debug("event=workspace.access.denied reason=capability workspaceId={} userId={} role={} capability={}",
                    workspaceId, userId, role, capability);
            throw new ForbiddenException(
                    "Your role in this workspace does not allow this action");
        }
        return role;
    }

    /**
     * Asserts that {@code userId} may read the content of {@code workspaceId}.
     *
     * <p>Returns nothing on purpose. This is the guard a module that owns workspace-scoped content calls, and
     * a {@code void} signature is what lets it do so without importing {@link WorkspaceRole} or
     * {@link WorkspaceCapability} — the capability table stays inside the module that owns it, rather than
     * spreading into every module that has content to protect.
     *
     * <p>Works on an archived workspace. Archiving stops changes, not reading.
     *
     * @throws ResourceNotFoundException when the caller is not a member
     */
    @Transactional(readOnly = true)
    public void requireContentReader(UUID workspaceId, UUID userId) {
        requireCapability(workspaceId, userId, WorkspaceCapability.VIEW_CONTENT);
    }

    /**
     * Asserts that {@code userId} may change the content of {@code workspaceId}, and that the workspace still
     * accepts changes.
     *
     * <p>The archived check is bundled in rather than left to the caller. Every write to workspace-owned
     * content has to be refused on an archived workspace, so making it part of the guard means a new content
     * module cannot forget it — and there is no second definition of "archived" to drift from the one on
     * {@code Workspace}.
     *
     * <p>Ordered so a non-member learns nothing: the membership check runs first, so the {@code 409} is only
     * ever seen by somebody who already has access.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the workspace does not exist
     * @throws ForbiddenException        when the caller is a member without {@code EDIT_CONTENT}, so a viewer
     * @throws ConflictException         when the workspace is archived
     */
    @Transactional(readOnly = true)
    public void requireContentEditor(UUID workspaceId, UUID userId) {
        requireCapability(workspaceId, userId, WorkspaceCapability.EDIT_CONTENT);

        workspaces.findById(workspaceId)
                .orElseThrow(() -> new ResourceNotFoundException(WORKSPACE_NOT_FOUND))
                .toDomain()
                .requireActive("changed");
    }

    /** Internal maintenance only: no membership or artificial user account is created. */
    @Transactional(readOnly=true)
    public boolean permitsSystemContentMaintenance(UUID workspaceId) {
        return workspaces.findById(workspaceId).map(row -> !row.toDomain().isArchived()).orElse(false);
    }

    /** Separate capability for explicit AI contributions; also enforces the active workspace rule. */
    @Transactional(readOnly = true)
    public void requireAiContributor(UUID workspaceId, UUID userId) {
        requireCapability(workspaceId, userId, WorkspaceCapability.USE_AI);
        requireContentEditor(workspaceId, userId);
    }
}
