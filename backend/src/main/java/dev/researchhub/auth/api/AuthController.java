package dev.researchhub.auth.api;

import dev.researchhub.auth.infrastructure.BrowserSession;
import dev.researchhub.shared.error.UnauthenticatedException;
import dev.researchhub.user.application.RegisterUserCommand;
import dev.researchhub.user.application.UserAccount;
import dev.researchhub.user.application.UserAuthenticationService;
import dev.researchhub.user.application.UserRegistrationService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.UUID;

/**
 * Registration, login, and the current-user endpoint.
 *
 * <p>Implements docs/adr/ADR-001-authentication.md: a successful login establishes a server-side
 * session and the browser receives only a session cookie. No token is minted, returned, or expected in
 * an {@code Authorization} header.
 *
 * <p>Active on the {@code local} profile only, because it depends on {@code user.application}, which
 * needs the user repository, which exists only where JPA is auto-configured. The {@code test} and
 * {@code cloud} profiles exclude JDBC and JPA, so these routes are absent there. The security filter
 * chain itself applies on every profile — see
 * {@code dev.researchhub.auth.infrastructure.SecurityConfiguration}.
 */
@RestController
@RequestMapping("/api/auth")
@Profile("local")
public class AuthController {

    /**
     * Stable event names so authentication activity can be found in logs without parsing prose.
     * Neither the password nor the stored hash is ever an argument to these.
     */
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final UserRegistrationService registrationService;
    private final UserAuthenticationService authenticationService;
    private final BrowserSession browserSession;

    public AuthController(UserRegistrationService registrationService,
                          UserAuthenticationService authenticationService,
                          BrowserSession browserSession) {
        this.registrationService = registrationService;
        this.authenticationService = authenticationService;
        this.browserSession = browserSession;
    }

    /**
     * Creates an account.
     *
     * <p>Returns 201 without a session: registering and signing in are separate steps, so the client
     * calls login next. A duplicate email is a 409 {@code CONFLICT}; a broken field is a 400
     * {@code VALIDATION_FAILED} listing the field.
     */
    @PostMapping("/register")
    ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        UserAccount account = registrationService.register(new RegisterUserCommand(
                request.email(), request.password(), request.displayName()));

        log.info("event=auth.register.success userId={}", account.id());
        return ResponseEntity.status(HttpStatus.CREATED).body(UserResponse.from(account));
    }

    /**
     * Verifies credentials and starts the session.
     *
     * <p>Every failure — unknown address, wrong password, or an account that is not active — produces
     * the identical 401 body. Distinguishing them would let anyone test which email addresses have
     * accounts here.
     */
    @PostMapping("/login")
    UserResponse login(@Valid @RequestBody LoginRequest request,
                       HttpServletRequest httpRequest,
                       HttpServletResponse httpResponse) {
        Optional<UserAccount> authenticated =
                authenticationService.authenticate(request.email(), request.password());

        if (authenticated.isEmpty()) {
            // The attempted address is logged because brute-force and credential-stuffing attempts are
            // only visible with it. The submitted password is not.
            log.warn("event=auth.login.failure reason=invalid_credentials email={}", request.email());
            throw new UnauthenticatedException("Invalid email or password");
        }

        UserAccount account = authenticated.get();
        browserSession.start(account.id(), httpRequest, httpResponse);

        log.info("event=auth.login.success userId={}", account.id());
        return UserResponse.from(account);
    }

    /**
     * The signed-in user, or 401.
     *
     * <p>This is what makes a browser refresh work: the SPA keeps nothing across a reload, calls this
     * with the session cookie the browser still holds, and gets the user back.
     *
     * <p>The account is re-read rather than taken from the session, so a user disabled or locked since
     * signing in is rejected here instead of continuing on a stale copy.
     */
    @GetMapping("/me")
    UserResponse currentUser() {
        UUID userId = browserSession.currentUserId()
                .orElseThrow(() -> new UnauthenticatedException("Authentication is required"));

        return authenticationService.findActiveById(userId)
                .map(UserResponse::from)
                .orElseThrow(() -> {
                    log.warn("event=auth.session.rejected reason=account_unavailable userId={}", userId);
                    return new UnauthenticatedException("Authentication is required");
                });
    }

    /**
     * Primes the CSRF cookie.
     *
     * <p>A fresh SPA has no {@code XSRF-TOKEN} cookie, and its first request is a POST to login or
     * register, which CSRF protection would reject. Calling this first is the documented way to obtain
     * the cookie. Taking {@link CsrfToken} as a parameter is what causes the token to be resolved and
     * the cookie to be written.
     */
    @GetMapping("/csrf")
    ResponseEntity<Void> csrf(CsrfToken csrfToken) {
        csrfToken.getToken();
        return ResponseEntity.noContent().build();
    }

}
