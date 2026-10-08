package dev.researchhub.auth.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/me} — the canonical identity read.
 *
 * <p>Separate from {@link AuthController} only because that class is mapped under {@code /api/auth} and
 * this route sits at the top level: identity is something the whole application asks about, not a detail
 * of the sign-in flow. Both go through {@link CurrentUserResolver}, so the two paths cannot diverge.
 *
 * <p>Authenticated by the default deny rule in
 * {@code dev.researchhub.auth.infrastructure.SecurityConfiguration}; an anonymous caller is answered by
 * the entry point with {@code 401 UNAUTHENTICATED} before reaching this class.
 */
@RestController
public class CurrentUserController {

    private final CurrentUserResolver currentUserResolver;

    public CurrentUserController(CurrentUserResolver currentUserResolver) {
        this.currentUserResolver = currentUserResolver;
    }

    @GetMapping("/api/me")
    UserResponse currentUser() {
        return UserResponse.from(currentUserResolver.requireCurrentUser());
    }

}
