package dev.researchhub.auth.api;

import dev.researchhub.auth.application.*;
import dev.researchhub.auth.infrastructure.BrowserSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/auth")
public class AccountSettingsController {
    public record PasswordRequest(@NotNull @Size(min=1,max=72) String currentPassword,@StrongPassword String newPassword) {
        @Override public String toString() { return "PasswordRequest[REDACTED]"; }
    }
    private final CurrentUserResolver users;
    private final AccountSettingsService settings;
    private final BrowserSession browser;
    public AccountSettingsController(CurrentUserResolver users,AccountSettingsService settings,BrowserSession browser) {
        this.users=users;this.settings=settings;this.browser=browser;
    }
    @PostMapping("/password")
    public ResponseEntity<Void> password(@Valid @RequestBody PasswordRequest body,HttpServletRequest request) {
        settings.password(users.requireCurrentUser().id(),body.currentPassword(),body.newPassword(),current(request));
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/sessions")
    public ResponseEntity<List<AccountSessionService.Summary>> sessions(HttpServletRequest request) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body(settings.sessions(users.requireCurrentUser().id(),current(request)));
    }
    @DeleteMapping("/sessions/{handle}")
    public ResponseEntity<Void> revoke(@PathVariable String handle,HttpServletRequest request) {
        if (settings.revoke(users.requireCurrentUser().id(),handle,current(request))) browser.end(request);
        return ResponseEntity.noContent().build();
    }
    @PostMapping("/sessions/revoke-all")
    public ResponseEntity<Void> revokeAll(HttpServletRequest request) {
        settings.revokeAll(users.requireCurrentUser().id()); browser.end(request); return ResponseEntity.noContent().build();
    }
    private static String current(HttpServletRequest request) { var s=request.getSession(false); return s==null?null:s.getId(); }
}
