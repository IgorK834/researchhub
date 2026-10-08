package dev.researchhub.user.application;

import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.observability.CorrelationContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.function.Supplier;

/** Account creation policy also applies to non-HTTP callers of UserRegistrationService. */
@Component
public class RegistrationPolicy {
    public enum Mode {
        OPEN("open"), INVITE_ONLY("invite-only"), DISABLED("disabled");
        private final String value;
        Mode(String value) { this.value = value; }
        public String value() { return value; }
        public static Mode parse(String value) {
            return Arrays.stream(values()).filter(mode -> mode.value.equals(value)).findFirst()
                    .orElseThrow(() -> new IllegalStateException("Registration mode must be open, invite-only or disabled"));
        }
    }
    private final Mode mode;
    private final RegistrationRejectionAudit audit;
    private final RegistrationInvitations invitations;
    public RegistrationPolicy(@Value("${researchhub.auth.registration.mode:open}") String mode,
                              RegistrationRejectionAudit audit, RegistrationInvitations invitations) {
        this.mode = Mode.parse(mode); this.audit = audit; this.invitations = invitations;
    }
    public Mode mode() { return mode; }
    public UserAccount register(RegisterUserCommand command, Supplier<UserAccount> create) {
        if (mode == Mode.OPEN) return create.get();
        if (mode == Mode.INVITE_ONLY) {
            var accepted = invitations.register(command, create);
            if (accepted != null) return accepted;
        }
        audit.rejected(CorrelationContext.currentOrNew(), mode.value());
        throw new ForbiddenException(mode == Mode.DISABLED ? "Account registration is disabled" : "A valid invitation is required");
    }
}
