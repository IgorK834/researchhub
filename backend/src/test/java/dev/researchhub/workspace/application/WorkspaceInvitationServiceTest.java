package dev.researchhub.workspace.application;

import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.*;
import dev.researchhub.workspace.domain.*;
import dev.researchhub.workspace.infrastructure.*;
import org.junit.jupiter.api.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static dev.researchhub.workspace.infrastructure.PostgresInvitationStore.Invitation;

class WorkspaceInvitationServiceTest {
    final PostgresInvitationStore store=mock(PostgresInvitationStore.class);final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final WorkspaceRepository workspaces=mock(WorkspaceRepository.class);final WorkspaceMemberRepository members=mock(WorkspaceMemberRepository.class);
    final AccountSecurityService accounts=mock(AccountSecurityService.class);final SecurityOperationLimiter limits=mock(SecurityOperationLimiter.class);final ProductAudit audit=mock(ProductAudit.class);
    final Instant now=Instant.parse("2026-10-12T10:00:00Z");final UUID ws=UUID.randomUUID(),user=UUID.randomUUID(),inviter=UUID.randomUUID();
    final String token=SecureTokens.create();
    final WorkspaceInvitationService service=new WorkspaceInvitationService(store,auth,workspaces,members,accounts,limits,audit,Clock.fixed(now,ZoneOffset.UTC));
    Invitation row(Instant accepted,Instant revoked,Instant expires) {return new Invitation(UUID.randomUUID(),ws,"ada@example.test","EDITOR",inviter,expires,accepted,revoked,now);}
    @BeforeEach void active() {
        var entity=mock(WorkspaceEntity.class);var workspace=mock(Workspace.class);when(entity.toDomain()).thenReturn(workspace);when(workspaces.findByIdForUpdate(ws)).thenReturn(Optional.of(entity));
        when(auth.requireCapability(ws,inviter,WorkspaceCapability.MANAGE_MEMBERS)).thenReturn(WorkspaceRole.OWNER);
    }
    @Test void creationChecksRoleCeilingAndNormalizesStoresOnlyHashesAndAudits() {
        when(auth.requireCapability(ws,user,WorkspaceCapability.MANAGE_MEMBERS)).thenReturn(WorkspaceRole.EDITOR);
        assertThrows(ForbiddenException.class,()->service.create(ws,user,"ada@example.test",WorkspaceRole.OWNER));
        assertThrows(ForbiddenException.class,()->service.create(ws,user,"ada@example.test",null));verifyNoInteractions(store,limits,audit);
        when(auth.requireCapability(ws,user,WorkspaceCapability.MANAGE_MEMBERS)).thenReturn(WorkspaceRole.OWNER);
        var result=service.create(ws,user," Ada@Example.test ",WorkspaceRole.EDITOR);assertEquals("ada@example.test",result.invitation().email());
        assertEquals(now.plusSeconds(7*86400),result.invitation().expiresAt());verify(store).create(result.invitation(),SecureTokens.hash(result.token()));
        assertFalse(result.toString().contains(result.token()));assertFalse(new dev.researchhub.workspace.api.WorkspaceInvitationController.CreatedResponse(result.invitation(),result.token()).toString().contains(result.token()));
        verify(audit).invitation(ws,user,result.invitation().id(),ProductAudit.Type.INVITATION_CREATED,"EDITOR");
        service.list(ws,user);verify(store).list(ws);
    }
    @Test void acceptanceChecksVerificationEmailExistingMembershipAndInviterAuthority() {
        var row=row(null,null,now.plusSeconds(1));when(store.lockToken(SecureTokens.hash(token))).thenReturn(Optional.of(row));
        when(accounts.require(user)).thenReturn(new AccountSecurityService.Identity(user,"ada@example.test","ada@example.test","Ada",null));
        assertThrows(ForbiddenException.class,()->service.accept(token,user));
        when(accounts.require(user)).thenReturn(new AccountSecurityService.Identity(user,"ada@example.test","ada@example.test","Ada",now));
        when(auth.requireCapability(ws,inviter,WorkspaceCapability.MANAGE_MEMBERS)).thenReturn(WorkspaceRole.VIEWER);assertThrows(ApiException.class,()->service.accept(token,user));
        when(auth.requireCapability(ws,inviter,WorkspaceCapability.MANAGE_MEMBERS)).thenReturn(WorkspaceRole.OWNER);
        when(members.findByWorkspaceIdAndUserId(ws,user)).thenReturn(Optional.of(mock(WorkspaceMemberEntity.class)));assertThrows(ConflictException.class,()->service.accept(token,user));
        when(members.findByWorkspaceIdAndUserId(ws,user)).thenReturn(Optional.empty());assertEquals(ws,service.accept(token,user));verify(store).accept(row.id(),now);verify(audit).invitation(ws,user,row.id(),ProductAudit.Type.INVITATION_ACCEPTED,"EDITOR");
    }
    @Test void tokenValidationRejectsEveryTerminalStateAndUnknownToken() {
        assertThrows(ApiException.class,()->service.validToken(null));assertThrows(ApiException.class,()->service.validToken("bad"));
        when(store.lockToken(SecureTokens.hash(token))).thenReturn(Optional.empty());assertThrows(ApiException.class,()->service.validToken(token));
        for(var row:List.of(row(now,null,now.plusSeconds(2)),row(null,now,now.plusSeconds(2)),row(null,null,now))) {
            when(store.lockToken(SecureTokens.hash(token))).thenReturn(Optional.of(row));assertThrows(ApiException.class,()->service.validToken(token));
        }
    }
    @Test void revocationIsScopedIdempotentAndCannotUndoAcceptance() {
        var row=row(null,null,now.plusSeconds(2));when(store.lockId(ws,row.id())).thenReturn(Optional.of(row));service.revoke(ws,user,row.id());verify(store).revoke(row.id(),now);
        when(store.lockId(ws,row.id())).thenReturn(Optional.of(new Invitation(row.id(),ws,row.email(),row.role(),inviter,row.expiresAt(),null,now,now)));service.revoke(ws,user,row.id());verify(store,times(1)).revoke(row.id(),now);
        when(store.lockId(ws,row.id())).thenReturn(Optional.of(row(now,null,now.plusSeconds(2))));assertThrows(ConflictException.class,()->service.revoke(ws,user,row.id()));
        when(store.lockId(ws,row.id())).thenReturn(Optional.empty());assertThrows(ResourceNotFoundException.class,()->service.revoke(ws,user,row.id()));
        when(workspaces.findByIdForUpdate(ws)).thenReturn(Optional.empty());assertThrows(ResourceNotFoundException.class,()->service.active(ws));
    }
    @Test void registrationAdapterFailsClosedAndDoesNotConsumeInvitationBeforeVerification() {
        var invitations=mock(WorkspaceInvitationService.class);var adapter=new WorkspaceRegistrationInvitations(invitations);
        var command=new RegisterUserCommand("ADA@example.test","password","Ada",token);var account=mock(UserAccount.class);
        when(invitations.validToken(token)).thenReturn(row(null,null,now.plusSeconds(1)));assertSame(account,adapter.register(command,()->account));verify(invitations).active(ws);
        assertNull(adapter.register(new RegisterUserCommand("other@example.test","password","Other",token),()->{throw new AssertionError();}));
        when(invitations.validToken(token)).thenThrow(new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invalid invitation"));assertNull(adapter.register(command,()->{throw new AssertionError();}));
    }
}
