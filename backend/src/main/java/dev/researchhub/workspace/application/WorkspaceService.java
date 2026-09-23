package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.domain.Workspace;
import dev.researchhub.workspace.domain.WorkspaceMembership;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.WorkspaceEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import dev.researchhub.workspace.infrastructure.WorkspaceRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Creating and reading workspaces.
 *
 * <p>Every read is scoped to the caller. There is no method that lists workspaces without a user, and
 * the repositories below cannot provide one — see {@code WorkspaceRepository}.
 *
 * <p>Active on the {@code local} profile only, because it needs repositories, which exist only where
 * JPA is auto-configured. The {@code test} and {@code cloud} profiles exclude JDBC and JPA entirely, so
 * omitting this guard would stop {@code BackendApplicationTests} and {@code CloudProfileStartupTests}
 * from starting (docs/development/backend-architecture.md).
 */
@Service
@Profile("local")
public class WorkspaceService {

    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;

    public WorkspaceService(WorkspaceRepository workspaces, WorkspaceMemberRepository members,
                            WorkspaceAuthorizationService authorization, Clock clock) {
        this.workspaces = workspaces;
        this.members = members;
        this.authorization = authorization;
        this.clock = clock;
    }

    /**
     * Creates a workspace and the creator's {@code OWNER} membership.
     *
     * <p><strong>One transaction, two inserts.</strong> A workspace is reachable only through a
     * membership, so a workspace with no membership row would be invisible and unreachable to everyone
     * including its creator — a row nobody can read, delete, or grant access to. Writing them in
     * separate transactions would make that state possible whenever the second insert failed, so the
     * method is {@code @Transactional} and a failure on the membership rolls the workspace back with
     * it. {@code WorkspaceServiceIntegrationTest} forces that failure and asserts no workspace row
     * survives.
     *
     * <p>This is why the class differs from {@code UserRegistrationService}, which is deliberately not
     * transactional: registration writes exactly one row, so a single insert is already atomic.
     *
     * @throws ApiException {@code VALIDATION_FAILED} when the name or description breaks a domain rule.
     *                      The HTTP layer normally catches this first with Bean Validation and produces
     *                      field errors; this is the backstop for other callers.
     */
    @Transactional
    public WorkspaceSummary create(CreateWorkspaceCommand command) {
        Instant now = clock.instant();
        Workspace workspace = newWorkspace(command, now);

        WorkspaceEntity savedWorkspace = workspaces.saveAndFlush(WorkspaceEntity.fromDomain(workspace));

        // The creator is the first owner, and every later owner is granted by an existing one. A
        // workspace therefore starts with exactly one OWNER and, by the rule in WorkspaceMembers, never
        // drops below one.
        WorkspaceMembership ownership = WorkspaceMembership.create(
                savedWorkspace.getId(), command.createdBy(), WorkspaceRole.OWNER, now);
        members.saveAndFlush(WorkspaceMemberEntity.fromDomain(ownership));

        return WorkspaceSummary.from(savedWorkspace.toDomain(), WorkspaceRole.OWNER);
    }

    /**
     * The workspaces {@code userId} belongs to, newest first, each with the role that user holds.
     *
     * <p>Built from the caller's memberships rather than by filtering a list of all workspaces. The
     * difference matters: there is no moment at which a workspace the caller cannot see is loaded, so a
     * later bug in a filter cannot leak one.
     */
    @Transactional(readOnly = true)
    public List<WorkspaceSummary> listForMember(UUID userId) {
        Map<UUID, WorkspaceRole> rolesByWorkspace = new LinkedHashMap<>();
        for (WorkspaceMemberEntity membership : members.findByUserId(userId)) {
            rolesByWorkspace.put(membership.getWorkspaceId(), membership.getRole());
        }
        if (rolesByWorkspace.isEmpty()) {
            return List.of();
        }

        return workspaces.findByIdInOrderByCreatedAtDesc(rolesByWorkspace.keySet()).stream()
                .map(entity -> WorkspaceSummary.from(
                        entity.toDomain(), rolesByWorkspace.get(entity.getId())))
                .toList();
    }

    /**
     * One workspace, only for a member of it.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the workspace does not
     *                                   exist. The two are indistinguishable on purpose; see
     *                                   {@link WorkspaceAuthorizationService}.
     */
    @Transactional(readOnly = true)
    public WorkspaceSummary findForMember(UUID workspaceId, UUID userId) {
        WorkspaceRole role = authorization.requireMember(workspaceId, userId);

        return workspaces.findById(workspaceId)
                .map(entity -> WorkspaceSummary.from(entity.toDomain(), role))
                .orElseThrow(() -> new ResourceNotFoundException(
                        WorkspaceAuthorizationService.WORKSPACE_NOT_FOUND));
    }

    private static Workspace newWorkspace(CreateWorkspaceCommand command, Instant now) {
        try {
            return Workspace.create(command.name(), command.description(), command.createdBy(), now);
        } catch (IllegalArgumentException invalid) {
            // The domain message is written for a user and names no internal detail.
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage());
        }
    }

}
