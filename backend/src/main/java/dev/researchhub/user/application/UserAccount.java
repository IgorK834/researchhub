package dev.researchhub.user.application;

import dev.researchhub.user.domain.User;

import java.util.UUID;

/**
 * Public view of a user: exactly the fields that may leave the backend.
 *
 * <p>This is the type other modules and the HTTP layer are allowed to see, and it is why the password
 * hash cannot leak by accident: there is no field for it. {@code normalizedEmail} is also absent,
 * because it is an internal uniqueness key rather than something a client should render or compare
 * against.
 *
 * <p>{@code email} is the address as the user entered it, trimmed, so the UI shows the casing they
 * chose. {@code status} is the enum name rather than the enum, so a module that may depend on
 * {@code user.application} does not thereby depend on {@code user.domain}.
 */
public record UserAccount(UUID id, String email, String displayName, String status) {

    static UserAccount from(User user) {
        return new UserAccount(user.id(), user.email().value(), user.displayName(), user.status().name());
    }

}
