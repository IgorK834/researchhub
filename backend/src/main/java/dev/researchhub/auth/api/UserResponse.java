package dev.researchhub.auth.api;

import dev.researchhub.user.application.UserAccount;

import java.util.UUID;

/**
 * The public user payload returned by register, login, and the current-user endpoint.
 *
 * <p>All three return the same shape on purpose: the SPA has one user type to model, and the body it
 * caches after login is the body it re-fetches after a refresh.
 *
 * <p>There is no password or hash field here, and none can be added by accident, because
 * {@link UserAccount} does not carry one either.
 */
public record UserResponse(UUID id, String email, String displayName, String status) {

    static UserResponse from(UserAccount account) {
        return new UserResponse(account.id(), account.email(), account.displayName(), account.status());
    }

}
