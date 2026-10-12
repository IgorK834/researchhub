package dev.researchhub.workspace.infrastructure;

import dev.researchhub.user.application.*;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.workspace.application.WorkspaceInvitationService;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.util.function.Supplier;

@Component
public class WorkspaceRegistrationInvitations implements RegistrationInvitations {
    private final WorkspaceInvitationService invitations;
    public WorkspaceRegistrationInvitations(WorkspaceInvitationService invitations) { this.invitations=invitations; }
    @Transactional
    public UserAccount register(RegisterUserCommand command,Supplier<UserAccount> create) {
        try {
            var row=invitations.validToken(command.invitationToken());
            if (!row.email().equals(AccountSecurityService.normalize(command.email()))) return null;
            invitations.active(row.workspaceId());
            invitations.requireInviter(row);
        } catch (ApiException invalid) { return null; }
        return create.get();
    }
}
