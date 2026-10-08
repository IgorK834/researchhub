package dev.researchhub.user.application;

import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.user.infrastructure.*;
import dev.researchhub.shared.observability.CorrelationContext;
import org.junit.jupiter.api.Test;
import java.time.Clock;
import java.util.function.Supplier;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RegistrationPolicyTest {
    final RegistrationRejectionAudit audit = mock(RegistrationRejectionAudit.class);
    final RegisterUserCommand command = new RegisterUserCommand("secret@example.test", "long-enough-password", "Secret");
    @Test void openPreservesAccountCreationAndAllModesAreExplicit() {
        var account = mock(UserAccount.class);
        var policy = new RegistrationPolicy("open", audit, new UnavailableRegistrationInvitations());
        assertSame(account, policy.register(command, () -> account)); verifyNoInteractions(audit);
        for (var mode : RegistrationPolicy.Mode.values()) assertEquals(mode, RegistrationPolicy.Mode.parse(mode.value()));
        assertThrows(IllegalStateException.class, () -> RegistrationPolicy.Mode.parse("OPEN"));
        assertEquals(RegistrationPolicy.Mode.OPEN, policy.mode());
    }
    @Test void closedModesNeverReadUsersOrHashPasswordsAndAuditOnlyRequestId() {
        for (String mode : new String[]{"disabled", "invite-only"}) {
            var users = mock(UserRepository.class); var passwords = mock(org.springframework.security.crypto.password.PasswordEncoder.class);
            var policy = new RegistrationPolicy(mode, audit, new UnavailableRegistrationInvitations());
            var service = new UserRegistrationService(users, passwords, new PasswordPolicy(12), Clock.systemUTC(), policy);
            try (var scope = CorrelationContext.open("registration-policy-test")) {
                assertThrows(ForbiddenException.class, () -> service.register(command));
                assertThrows(ForbiddenException.class, () -> service.register(new RegisterUserCommand("existing@example.test", "bad", "")));
            }
            verifyNoInteractions(users, passwords);
            verify(audit, times(2)).rejected("registration-policy-test", mode);
        }
    }
    @Test void futureInvitationAdapterMustOwnAtomicAccountCreation() {
        var invitations = mock(RegistrationInvitations.class); var account = mock(UserAccount.class);
        Supplier<UserAccount> create = () -> account;
        when(invitations.register(command, create)).thenReturn(account);
        assertSame(account, new RegistrationPolicy("invite-only", audit, invitations).register(command, create));
        verifyNoInteractions(audit);
    }
}
