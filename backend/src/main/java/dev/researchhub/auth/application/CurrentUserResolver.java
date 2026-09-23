package dev.researchhub.auth.application;

import dev.researchhub.auth.infrastructure.BrowserSession;
import dev.researchhub.shared.error.UnauthenticatedException;
import dev.researchhub.user.application.UserAccount;
import dev.researchhub.user.application.UserAuthenticationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Resolves the caller's identity from the session.
 *
 * <p>Exists so that {@code GET /api/me} and {@code GET /api/auth/me} are two routes over one
 * implementation. Duplicating the lookup would let the alias drift from the canonical path — returning a
 * different body, or disagreeing about when a session is still valid.
 *
 * <p>Active on the {@code local} profile only, because it needs {@link UserAuthenticationService}, which
 * needs the user repository. See docs/development/backend-architecture.md.
 */
@Service
@Profile("local")
public class CurrentUserResolver {

    private static final Logger log = LoggerFactory.getLogger(CurrentUserResolver.class);

    private final BrowserSession browserSession;
    private final UserAuthenticationService authenticationService;

    public CurrentUserResolver(BrowserSession browserSession,
                               UserAuthenticationService authenticationService) {
        this.browserSession = browserSession;
        this.authenticationService = authenticationService;
    }

    /**
     * The signed-in user.
     *
     * <p>The account is read fresh rather than taken from the session, so an account disabled or locked
     * since sign-in is rejected here instead of continuing on a stale copy until the session expires.
     *
     * @throws UnauthenticatedException when the request carries no usable session, or the account behind
     *                                  it can no longer sign in
     */
    public UserAccount requireCurrentUser() {
        UUID userId = browserSession.currentUserId()
                .orElseThrow(() -> new UnauthenticatedException("Authentication is required"));

        return authenticationService.findActiveById(userId)
                .orElseThrow(() -> {
                    // The session is technically valid but the account behind it is not usable, which is
                    // worth seeing in a log: it means a disabled user is still holding a live session.
                    log.warn("event=auth.session.rejected reason=account_unavailable userId={}", userId);
                    return new UnauthenticatedException("Authentication is required");
                });
    }

}
