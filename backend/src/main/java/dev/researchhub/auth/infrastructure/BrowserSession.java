package dev.researchhub.auth.infrastructure;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
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
     * Signs the browser out, returning the id of whoever was signed in.
     *
     * <p>Invalidating the session is the whole of it. The stored security context goes with the session,
     * so the cookie the browser still holds no longer resolves to anything and the next request is
     * anonymous. Nothing has to be revoked, denylisted, or waited out — the property that made a
     * server-side session preferable to a self-contained token in ADR-001.
     *
     * <p>The context is cleared too, so the rest of this request does not still look signed in.
     *
     * @return the id of the user whose session ended, or empty when there was no session
     */
    public Optional<UUID> end(HttpServletRequest request) {
        Optional<UUID> endingUserId = currentUserId();

        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();

        return endingUserId;
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
