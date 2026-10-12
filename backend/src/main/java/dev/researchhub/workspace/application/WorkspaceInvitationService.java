package dev.researchhub.workspace.application;

import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.security.application.SecureTokens;
import dev.researchhub.security.application.SecurityOperationLimiter;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.AccountSecurityService;
import dev.researchhub.workspace.domain.*;
import dev.researchhub.workspace.infrastructure.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import static dev.researchhub.workspace.infrastructure.PostgresInvitationStore.Invitation;

@Service
public class WorkspaceInvitationService {
    public record Created(Invitation invitation, String token) {
        @Override public String toString() { return "Created[invitation="+invitation.id()+", token=REDACTED]"; }
    }
    private final PostgresInvitationStore store;
    private final WorkspaceAuthorizationService authorization;
    private final WorkspaceRepository workspaces;
    private final WorkspaceMemberRepository members;
    private final AccountSecurityService accounts;
    private final SecurityOperationLimiter limits;
    private final ProductAudit audit;
    private final Clock clock;
    public WorkspaceInvitationService(PostgresInvitationStore store, WorkspaceAuthorizationService authorization,
        WorkspaceRepository workspaces, WorkspaceMemberRepository members, AccountSecurityService accounts,
        SecurityOperationLimiter limits, ProductAudit audit, Clock clock) {
        this.store=store; this.authorization=authorization; this.workspaces=workspaces; this.members=members;
        this.accounts=accounts; this.limits=limits; this.audit=audit; this.clock=clock;
    }
    @Transactional
    public Created create(UUID workspace,UUID caller,String email,WorkspaceRole role) {
        var inviter=authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_MEMBERS);
        active(workspace);
        inviter=authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_MEMBERS);
        if (role==null || !inviter.capabilities().containsAll(role.capabilities()))
            throw new ForbiddenException("Invited role exceeds your role");
        String normalized=AccountSecurityService.normalize(email);
        limits.admit(caller.toString(), SecurityOperationLimiter.Operation.INVITE);
        var now=clock.instant(); var token=SecureTokens.create();
        var row=new Invitation(UUID.randomUUID(),workspace,normalized,role.name(),caller,now.plus(Duration.ofDays(7)),null,null,now);
        store.create(row,SecureTokens.hash(token)); audit.invitation(workspace,caller,row.id(),ProductAudit.Type.INVITATION_CREATED,row.role());
        return new Created(row,token);
    }
    @Transactional(readOnly=true)
    public List<Invitation> list(UUID workspace,UUID caller) {
        authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_MEMBERS); return store.list(workspace);
    }
    @Transactional
    public void revoke(UUID workspace,UUID caller,UUID id) {
        authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_MEMBERS);
        var row=store.lockId(workspace,id).orElseThrow(() -> new ResourceNotFoundException("Invitation was not found"));
        active(workspace);
        authorization.requireCapability(workspace,caller,WorkspaceCapability.MANAGE_MEMBERS);
        if (row.acceptedAt()!=null) throw new ConflictException("Invitation has already been accepted");
        if (row.revokedAt()==null) {
            store.revoke(id,clock.instant()); audit.invitation(workspace,caller,id,ProductAudit.Type.INVITATION_REVOKED,row.role());
        }
    }
    @Transactional
    public UUID accept(String token,UUID caller) {
        var row=validToken(token);
        var identity=accounts.require(caller);
        if (!row.email().equals(identity.normalizedEmail())) throw invalid();
        if (identity.emailVerifiedAt()==null) throw new ForbiddenException("Verify your email before accepting an invitation");
        active(row.workspaceId());
        // Recheck the inviter's current authority: stale links cannot restore removed privileges.
        requireInviter(row);
        if (members.findByWorkspaceIdAndUserId(row.workspaceId(),caller).isPresent())
            throw new ConflictException("You are already a member of this workspace");
        members.saveAndFlush(WorkspaceMemberEntity.fromDomain(WorkspaceMembership.create(row.workspaceId(),caller,WorkspaceRole.valueOf(row.role()),clock.instant())));
        store.accept(row.id(),clock.instant()); audit.invitation(row.workspaceId(),caller,row.id(),ProductAudit.Type.INVITATION_ACCEPTED,row.role());
        return row.workspaceId();
    }
    /** For invite-only registration; does not redeem the link before email verification. */
    public Invitation validToken(String token) {
        if (!SecureTokens.valid(token)) throw invalid();
        var row=store.lockToken(SecureTokens.hash(token)).orElseThrow(WorkspaceInvitationService::invalid);
        if (row.acceptedAt()!=null || row.revokedAt()!=null || !row.expiresAt().isAfter(clock.instant())) throw invalid();
        return row;
    }
    public void requireInviter(Invitation row) {
        var role=authorization.requireCapability(row.workspaceId(),row.invitedBy(),WorkspaceCapability.MANAGE_MEMBERS);
        if (!role.capabilities().containsAll(WorkspaceRole.valueOf(row.role()).capabilities())) throw invalid();
    }
    public void active(UUID workspace) {
        workspaces.findByIdForUpdate(workspace).orElseThrow(() -> new ResourceNotFoundException("Workspace was not found"))
            .toDomain().requireActive("changed");
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invitation is invalid or no longer available"); }
}
