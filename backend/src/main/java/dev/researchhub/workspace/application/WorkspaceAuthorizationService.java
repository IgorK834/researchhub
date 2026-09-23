package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
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
 * <p>Active on the {@code local} profile only, because it needs a repository, which exists only where
 * JPA is auto-configured (docs/development/backend-architecture.md).
 */
@Service
@Profile("local")
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

    public WorkspaceAuthorizationService(WorkspaceMemberRepository members) {
        this.members = members;
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

}
