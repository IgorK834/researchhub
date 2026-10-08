package dev.researchhub.user.infrastructure;

import dev.researchhub.user.application.*;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/** Task 30.2 is pending. Fail closed until an atomic invitation redemption adapter replaces this. */
@Component
public class UnavailableRegistrationInvitations implements RegistrationInvitations {
    public UserAccount register(RegisterUserCommand command, Supplier<UserAccount> create) { return null; }
}
