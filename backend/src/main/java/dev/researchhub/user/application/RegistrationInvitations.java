package dev.researchhub.user.application;

import java.util.function.Supplier;

/** Invitation redemption and account creation must commit together; null means invalid invitation. */
public interface RegistrationInvitations {
    UserAccount register(RegisterUserCommand command, Supplier<UserAccount> create);
}
