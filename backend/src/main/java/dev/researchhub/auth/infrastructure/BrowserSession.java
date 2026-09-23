package dev.researchhub.auth.infrastructure;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Establishes and reads the server-side session that identifies a signed-in browser.
 *
 * <p>Implements the storage half of docs/adr/ADR-001-authentication.md. The only thing that reaches the
 * browser is the session cookie; the identity lives in the session on the server. Nothing is signed,
 * encoded, or handed out for the client to keep, so there is no token to steal from JavaScript and
 * logging out or disabling an account takes effect on the next request.
 *
 * <p>What is stored is the user id and nothing else. Loading the account fresh on each request costs a
 * query but means a rename, a disable, or a lock is reflected immediately rather than persisting in a
 * stale copy until the session expires.
 */
@Component
public class BrowserSession {

    private final SecurityContextRepository securityContextRepository;

    public BrowserSession(SecurityContextRepository securityContextRepository) {
        this.securityContextRepository = securityContextRepository;
    }

    /** Signs the browser in. Call only after credentials have been verified. */
    public void start(UUID userId, HttpServletRequest request, HttpServletResponse response) {
        // Session fixation defence: if the caller arrived with a session id someone else may have
        // planted, replace it now, so the id that becomes authenticated is one we just minted.
        if (request.getSession(false) != null) {
            request.changeSessionId();
        }

        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                userId.toString(),
                // No credentials are retained. The password was needed to verify and nothing more.
                null,
                List.of());

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);
    }

    /**
     * The signed-in user's id, or empty when this request carries no usable session.
     *
     * <p>Reads the context the filter chain restored from the session cookie.
     */
    public Optional<UUID> currentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return Optional.empty();
        }
        return parseUuid(authentication.getName());
    }

    private static Optional<UUID> parseUuid(String value) {
        if (value == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(value));
        } catch (IllegalArgumentException notAUuid) {
            // A principal that is not one of ours. Treat it as no session rather than trusting it.
            return Optional.empty();
        }
    }

}
