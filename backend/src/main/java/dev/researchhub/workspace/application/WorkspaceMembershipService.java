package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.user.application.UserAccount;
import dev.researchhub.user.application.UserLookupService;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import dev.researchhub.workspace.domain.WorkspaceMembers;
import dev.researchhub.workspace.domain.WorkspaceMembership;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import dev.researchhub.workspace.infrastructure.WorkspaceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Who belongs to a workspace, and with which role.
 *
 * <p>The rules themselves are not here. Whether a change is legal — a workspace keeps at least one owner, a
 * stranger is not a member — is {@code WorkspaceMembers}, which is pure and unit-tested. Whether the caller
 * may ask is {@link WorkspaceAuthorizationService}. This class loads rows, hands them to those two, and
 * writes back what they decide. That split is why the last-owner rule cannot be bypassed by a new endpoint:
 * there is no code path that changes a membership without going through the domain type.
 *
 * <p>Reading the roster needs only membership, so an editor or viewer can see who their collaborators are.
 * Changing it needs {@link WorkspaceCapability#MANAGE_MEMBERS}, which only an owner holds.
 *
 * <p>Active on the {@code local} profile only, like {@link WorkspaceService}, because it needs repositories.
 */
@Service
@Profile("local")
public class WorkspaceMembershipService {

    /**
     * One answer for every reason an email does not resolve: unknown, malformed, or a disabled account.
     *
     * <p>Distinguishing them would make this endpoint an account-existence oracle for anyone who can create
     * a workspace — which is everyone.
     */
    static final String NO_SUCH_USER = "No registered user has that email";

    private static final String ALREADY_A_MEMBER = "That user is already a member of this workspace";

    private static final Logger log = LoggerFactory.getLogger(WorkspaceMembershipService.class);

    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;
    private final WorkspaceAuthorizationService authorization;
    private final UserLookupService userLookup;
    private final Clock clock;

    public WorkspaceMembershipService(WorkspaceRepository workspaces, WorkspaceMemberRepository members,
                                      WorkspaceAuthorizationService authorization,
                                      UserLookupService userLookup, Clock clock) {
        this.workspaces = workspaces;
        this.members = members;
        this.authorization = authorization;
        this.userLookup = userLookup;
        this.clock = clock;
    }

    /**
     * Everyone in the workspace, oldest membership first.
     *
     * <p>Requires membership rather than {@code MANAGE_MEMBERS}: a viewer who cannot change the roster can
     * still see it. A non-member gets the usual 404, so the roster does not reveal that the workspace exists.
     *
     * <p>Works on an archived workspace too. Archiving stops changes, not reading.
     */
    @Transactional(readOnly = true)
    public List<WorkspaceMemberSummary> listMembers(UUID workspaceId, UUID callerId) {
        authorization.requireMember(workspaceId, callerId);

        return summarize(members.findByWorkspaceIdOrderByCreatedAtAsc(workspaceId).stream()
                .map(WorkspaceMemberEntity::toDomain)
                .toList());
    }

    /**
     * Adds an existing, active user as an editor or viewer.
     *
     * <p>Deliberately <strong>not</strong> {@code @Transactional}, for the same reason
     * {@code UserRegistrationService.register} is not: it writes exactly one row, so the insert is already
     * atomic, and catching the unique-constraint violation inside a transaction would leave the caller
     * holding a rollback-only transaction that fails on commit — turning a 409 into a 500.
     *
     * <p>{@code OWNER} is refused with {@code VALIDATION_FAILED}. Ownership is granted to someone who is
     * already in the workspace, through {@link #changeRole}, so the person promoting them is looking at an
     * established member rather than typing an address. It also keeps this endpoint from being a one-step
     * way to hand a workspace to an arbitrary account.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or no active user has that email
     * @throws ForbiddenException        when the caller is a member without {@code MANAGE_MEMBERS}
     * @throws ConflictException         when the workspace is archived, or that user is already a member
     * @throws ApiException              {@code VALIDATION_FAILED} for a role this endpoint does not accept
     */
    public WorkspaceMemberSummary addMember(UUID workspaceId, UUID callerId,
                                            AddWorkspaceMemberCommand command) {
        authorization.requireCapability(workspaceId, callerId, WorkspaceCapability.MANAGE_MEMBERS);
        requireActiveWorkspace(workspaceId);

        WorkspaceRole role = parseRole(command.role());
        if (role == WorkspaceRole.OWNER) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,
                    "A new member joins as EDITOR or VIEWER. Promote an existing member to owner instead.");
        }

        // The email never reaches the response, and no branch below reveals which of "unknown",
        // "malformed", or "disabled" applied.
        UserAccount account = userLookup.findActiveByEmail(command.email())
                .orElseThrow(() -> new ResourceNotFoundException(NO_SUCH_USER));

        // Checked before the insert so the ordinary duplicate case never hits the constraint. The unique
        // index below is still the authority: this check can lose a race.
        if (members.findByWorkspaceIdAndUserId(workspaceId, account.id()).isPresent()) {
            throw new ConflictException(ALREADY_A_MEMBER);
        }

        WorkspaceMembership membership = WorkspaceMembership.create(
                workspaceId, account.id(), role, clock.instant());
        try {
            members.saveAndFlush(WorkspaceMemberEntity.fromDomain(membership));
        } catch (DataIntegrityViolationException raceLost) {
            // uq_workspace_members_workspace_user rejected a concurrent duplicate. Same answer as the
            // pre-check, so the client cannot tell which path it took.
            throw new ConflictException(ALREADY_A_MEMBER);
        }

        log.info("event=workspace.member.added workspaceId={} userId={} role={} byUserId={}",
                workspaceId, account.id(), role, callerId);
        return new WorkspaceMemberSummary(account.id(), account.email(), account.displayName(), role.name());
    }

    /**
     * Changes one member's role.
     *
     * <p>Promotion to {@code OWNER} is allowed and leaves the existing owner in place, so a workspace can
     * have several. Transferring ownership is therefore two steps — promote, then demote — and never a
     * moment with nobody in charge.
     *
     * <p>Setting the role a member already has is accepted and writes nothing, so a retried request is
     * harmless.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or {@code targetUserId} is not one
     * @throws ForbiddenException        when the caller is a member without {@code MANAGE_MEMBERS}
     * @throws ConflictException         when the workspace is archived, or this would demote the last owner
     */
    @Transactional
    public WorkspaceMemberSummary changeRole(UUID workspaceId, UUID callerId, UUID targetUserId,
                                             String role) {
        authorization.requireCapability(workspaceId, callerId, WorkspaceCapability.MANAGE_MEMBERS);
        requireActiveWorkspace(workspaceId);

        WorkspaceMembers roster = loadRoster(workspaceId);
        WorkspaceMembership updated = roster.changeRole(targetUserId, parseRole(role));

        // changeRole returns the membership unchanged when the role already matches, so the record is still
        // one of the rows we loaded. No write, and no pointless updated_at churn.
        if (!roster.memberships().contains(updated)) {
            members.saveAndFlush(WorkspaceMemberEntity.fromDomain(updated));
            log.info("event=workspace.member.role_changed workspaceId={} userId={} role={} byUserId={}",
                    workspaceId, targetUserId, updated.role(), callerId);
        }

        return summarize(List.of(updated)).getFirst();
    }

    /**
     * Removes one member's access.
     *
     * <p>Deletes exactly one {@code workspace_members} row. The user's account survives, and so does
     * everything that records what they did: docs/context.md sections 3.3 and 3.4 require authorship and
     * analysis provenance to stay traceable, so losing access must not rewrite history. Their login session
     * also stays valid — they are simply no longer a member, which the next request discovers as a 404.
     *
     * @throws ResourceNotFoundException when the caller is not a member, or {@code targetUserId} is not one
     * @throws ForbiddenException        when the caller is a member without {@code MANAGE_MEMBERS}
     * @throws ConflictException         when the workspace is archived, or this would remove the last owner
     */
    @Transactional
    public void removeMember(UUID workspaceId, UUID callerId, UUID targetUserId) {
        authorization.requireCapability(workspaceId, callerId, WorkspaceCapability.MANAGE_MEMBERS);
        requireActiveWorkspace(workspaceId);

        WorkspaceMembership removed = loadRoster(workspaceId).remove(targetUserId);
        members.deleteById(removed.id());

        log.info("event=workspace.member.removed workspaceId={} userId={} byUserId={}",
                workspaceId, targetUserId, callerId);
    }

    /**
     * The whole roster as a domain object, which is what can answer questions about the set.
     *
     * <p>Loaded inside the calling transaction so the decision and the write see the same rows. That is not
     * a lock: two owners demoting each other at the same instant could still both pass the
     * "another owner remains" check under {@code READ COMMITTED}. Closing that would need row locking on the
     * membership rows, and it is worth doing when a workspace realistically has several owners acting at
     * once — noted here rather than left as an assumption that this is airtight.
     */
    private WorkspaceMembers loadRoster(UUID workspaceId) {
        List<WorkspaceMembership> memberships = members.findByWorkspaceIdOrderByCreatedAtAsc(workspaceId)
                .stream()
                .map(WorkspaceMemberEntity::toDomain)
                .toList();

        return new WorkspaceMembers(workspaceId, memberships);
    }

    /**
     * Refuses a change to an archived workspace, by asking the workspace itself.
     *
     * <p>Runs after the authorization check, so a non-member is answered 404 and never learns that the
     * workspace exists, let alone that it is archived.
     */
    private void requireActiveWorkspace(UUID workspaceId) {
        workspaces.findById(workspaceId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        WorkspaceAuthorizationService.WORKSPACE_NOT_FOUND))
                .toDomain()
                .requireActive("changed");
    }

    /** Joins membership rows to the names and addresses the roster displays. */
    private List<WorkspaceMemberSummary> summarize(List<WorkspaceMembership> memberships) {
        Map<UUID, UserAccount> accounts = new HashMap<>();
        for (UserAccount account : userLookup.findAllByIds(
                memberships.stream().map(WorkspaceMembership::userId).toList())) {
            accounts.put(account.id(), account);
        }

        return memberships.stream()
                .map(membership -> {
                    UserAccount account = Objects.requireNonNull(accounts.get(membership.userId()),
                            () -> "membership references a user that does not exist: " + membership.userId());
                    return new WorkspaceMemberSummary(
                            membership.userId(), account.email(), account.displayName(),
                            membership.role().name());
                })
                .toList();
    }

    private static WorkspaceRole parseRole(String role) {
        if (role == null) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "role is required");
        }
        try {
            return WorkspaceRole.valueOf(role.strip());
        } catch (IllegalArgumentException unknown) {
            // The HTTP layer normally catches this first with a field error; this is the backstop for any
            // other caller.
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,
                    "role must be one of OWNER, EDITOR, VIEWER");
        }
    }

}
