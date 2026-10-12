package dev.researchhub.auth.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.auth.infrastructure.BrowserSession;
import dev.researchhub.user.application.AccountErasureService;
import dev.researchhub.user.application.AccountExportService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/account")
public class AccountDataController {
    public record Confirmation(@NotNull @Size(min=1,max=72) String password) {
        @Override public String toString(){return "Confirmation[REDACTED]";}
    }
    private final CurrentUserResolver users;
    private final AccountErasureService erasure;
    private final AccountExportService exports;
    private final BrowserSession browser;
    public AccountDataController(CurrentUserResolver users,AccountErasureService erasure,AccountExportService exports,BrowserSession browser) {
        this.users=users;this.erasure=erasure;this.exports=exports;this.browser=browser;
    }
    @GetMapping("/export")
    public ResponseEntity<AccountExportService.Export> export(){return ResponseEntity.ok().header("Cache-Control","private, no-store")
        .header("Content-Disposition","attachment; filename=\"account.json\"").body(exports.export(users.requireCurrentUser().id()));}
    @DeleteMapping
    public ResponseEntity<AccountErasureService.Accepted> delete(@Valid @RequestBody Confirmation input,HttpServletRequest request){
        var accepted=erasure.request(users.requireCurrentUser().id(),input.password());browser.end(request);
        return ResponseEntity.accepted().header("Cache-Control","private, no-store").body(accepted);
    }
    @GetMapping("/deletions/{id}")
    public ResponseEntity<AccountErasureService.Status> status(@PathVariable UUID id,@RequestHeader(value="X-Erasure-Receipt",required=false) String receipt) {
        return ResponseEntity.ok().header("Cache-Control","private, no-store").body(erasure.status(id,receipt));
    }
}
