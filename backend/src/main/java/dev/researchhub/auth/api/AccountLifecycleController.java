package dev.researchhub.auth.api;

import dev.researchhub.auth.application.*;
import dev.researchhub.user.application.AccountSecurityService;
import dev.researchhub.shared.validation.EmailFormat;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AccountLifecycleController {
    public record EmailRequest(@NotBlank @Email(regexp=EmailFormat.PATTERN) @Size(max=320) String email) {}
    public record TokenRequest(@NotBlank @Size(max=43) String token) {
        @Override public String toString() { return "TokenRequest[REDACTED]"; }
    }
    public record ResetRequest(@NotBlank @Size(max=43) String token,@StrongPassword String newPassword) {
        @Override public String toString() { return "ResetRequest[REDACTED]"; }
    }
    public record VerificationStatus(Instant emailVerifiedAt) {}
    private final AccountLifecycleService lifecycle;
    private final CurrentUserResolver users;
    private final AccountSecurityService accounts;
    public AccountLifecycleController(AccountLifecycleService lifecycle,CurrentUserResolver users,AccountSecurityService accounts) {
        this.lifecycle=lifecycle;this.users=users;this.accounts=accounts;
    }
    @PostMapping("/password-reset/request")
    public ResponseEntity<Map<String,String>> requestReset(@Valid @RequestBody EmailRequest body,HttpServletRequest request) {
        lifecycle.requestReset(body.email().strip(),request.getRemoteAddr());
        return ResponseEntity.accepted().header("Cache-Control","no-store").body(Map.of("message","If an account is eligible, a reset link will be sent."));
    }
    @PostMapping("/password-reset/complete")
    public ResponseEntity<Void> reset(@Valid @RequestBody ResetRequest body,HttpServletRequest request) {
        lifecycle.reset(body.token(),body.newPassword(),request.getRemoteAddr());return ResponseEntity.noContent().build();
    }
    @GetMapping("/email-verification")
    public VerificationStatus status() { return new VerificationStatus(accounts.require(users.requireCurrentUser().id()).emailVerifiedAt()); }
    @PostMapping("/email-verification/request")
    public ResponseEntity<Void> requestVerification() { lifecycle.requestVerification(users.requireCurrentUser().id());return ResponseEntity.accepted().build(); }
    @PostMapping("/email-verification/complete")
    public ResponseEntity<Void> verify(@Valid @RequestBody TokenRequest body) { lifecycle.verify(body.token(),users.requireCurrentUser().id());return ResponseEntity.noContent().build(); }
}
