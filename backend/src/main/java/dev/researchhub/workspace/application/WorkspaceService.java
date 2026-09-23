package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.workspace.domain.Workspace;
import dev.researchhub.workspace.domain.WorkspaceCapability;
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
 * Creating, reading, editing, and archiving workspaces.
 *
 * <p>Every read is scoped to the caller. There is no method that lists workspaces without a user, and
 * the repositories below cannot provide one — see {@code WorkspaceRepository}.
 *
 * <p>Every write goes through {@link WorkspaceAuthorizationService} before it touches a row, so there is
 * one place that decides what a role may do and no method here that quietly skips it.
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
     * The active workspaces {@code userId} belongs to, newest first, each with the role that user holds.
     *
     * <p>Built from the caller's memberships rather than by filtering a list of all workspaces. The
     * difference matters: there is no moment at which a workspace the caller cannot see is loaded, so a
     * later bug in a filter cannot leak one.
     *
     * <p>Archived workspaces are excluded, by the database, inside that membership-scoped query. They are
     * still reachable through {@link #findForMember} — archiving retires a workspace from the working
     * list without hiding its history from the people who were in it.
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

        return workspaces.findByIdInAndArchivedAtIsNullOrderByCreatedAtDesc(rolesByWorkspace.keySet())
                .stream()
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

        return WorkspaceSummary.from(requireWorkspace(workspaceId).toDomain(), role);
    }

    /**
     * Changes a workspace's name and description. Owners only.
     *
     * <p>Both fields are applied, so this replaces the metadata rather than merging whichever fields a
     * body happened to include; see {@code UpdateWorkspaceRequest}.
     *
     * <p>The order of the checks is the contract. Authorization runs first, so a non-member is answered
     * {@code 404} before anything about the workspace is read — including whether it is archived. Only a
     * caller who is already known to hold {@code MANAGE_WORKSPACE} can see the {@code 409}.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the workspace does not exist
     * @throws ForbiddenException        when the caller is a member without {@code MANAGE_WORKSPACE}
     * @throws ConflictException         when the workspace is archived
     * @throws ApiException              {@code VALIDATION_FAILED} when the new name or description breaks
     *                                   a domain rule
     */
    @Transactional
    public WorkspaceSummary updateMetadata(UUID workspaceId, UUID callerId,
                                           UpdateWorkspaceCommand command) {
        WorkspaceRole role = authorization.requireCapability(
                workspaceId, callerId, WorkspaceCapability.MANAGE_WORKSPACE);

        Workspace updated = applyMetadata(requireWorkspace(workspaceId).toDomain(), command,
                clock.instant());
        WorkspaceEntity saved = workspaces.saveAndFlush(WorkspaceEntity.fromDomain(updated));

        return WorkspaceSummary.from(saved.toDomain(), role);
    }

    /**
     * Archives a workspace. Owners only.
     *
     * <p>Soft by design: this sets {@code archived_at} and {@code archived_by} and deletes nothing. No
     * membership row is removed, and the workspace-owned tables that will exist later
     * (documents, sources, analyses) keep their rows and their stored files. docs/context.md sections 3.3
     * and 3.4 need that history to remain traceable, and an archive that destroyed it would be a delete
     * wearing a gentler name. There is deliberately no {@code DELETE} route.
     *
     * <p>Idempotent. Archiving an already archived workspace returns its current state, keeps the original
     * {@code archived_at}, and writes nothing at all — the domain is idempotent too, so the skipped write
     * here is an optimization rather than the rule.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or the workspace does not exist
     * @throws ForbiddenException        when the caller is a member without {@code MANAGE_WORKSPACE}
     */
    @Transactional
    public WorkspaceSummary archive(UUID workspaceId, UUID callerId) {
        WorkspaceRole role = authorization.requireCapability(
                workspaceId, callerId, WorkspaceCapability.MANAGE_WORKSPACE);

        Workspace workspace = requireWorkspace(workspaceId).toDomain();
        if (workspace.isArchived()) {
            return WorkspaceSummary.from(workspace, role);
        }

        Workspace archived = workspace.archive(callerId, clock.instant());
        WorkspaceEntity saved = workspaces.saveAndFlush(WorkspaceEntity.fromDomain(archived));

        return WorkspaceSummary.from(saved.toDomain(), role);
    }

    /**
     * The workspace row, which the caller has already been authorized to reach.
     *
     * <p>Reaching the {@code orElseThrow} means a membership exists for a workspace that does not, which
     * the foreign key makes impossible. It answers with the same message as every other not-found so the
     * impossible case cannot become the one response that says something different.
     */
    private WorkspaceEntity requireWorkspace(UUID workspaceId) {
        return workspaces.findById(workspaceId).orElseThrow(() -> new ResourceNotFoundException(
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

    /**
     * Applies both metadata fields at one instant.
     *
     * <p>A {@link ConflictException} from an archived workspace passes straight through: only
     * {@link IllegalArgumentException}, the domain's way of reporting an unusable value, becomes
     * {@code VALIDATION_FAILED}.
     */
    private static Workspace applyMetadata(Workspace workspace, UpdateWorkspaceCommand command,
                                           Instant now) {
        try {
            return workspace.rename(command.name(), now).describe(command.description(), now);
        } catch (IllegalArgumentException invalid) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage());
        }
    }

}
