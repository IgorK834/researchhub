package dev.researchhub.user.application;

import java.util.function.Supplier;

/** Invitation validation and account creation commit together; acceptance follows verified sign-in. Null means invalid invitation. */
public interface RegistrationInvitations {
    UserAccount register(RegisterUserCommand command, Supplier<UserAccount> create);
}
