package dev.researchhub.auth.application;

import dev.researchhub.auth.infrastructure.PostgresAccountTokenStore;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.AccountSecurityService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;

@Service
public class AccountLifecycleService {
    private final PostgresAccountTokenStore tokens;
    private final AccountSecurityService accounts;
    private final AccountSessionService sessions;
    private final SecurityOperationLimiter limits;
    private final AccountAudit audit;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final String baseUrl;
    public AccountLifecycleService(PostgresAccountTokenStore tokens,AccountSecurityService accounts,AccountSessionService sessions,
        SecurityOperationLimiter limits,AccountAudit audit,ApplicationEventPublisher events,Clock clock,
        @Value("${researchhub.auth.mail.public-base-url:http://localhost:3000}") String baseUrl) {
        var uri=URI.create(baseUrl);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost()==null || uri.getRawQuery()!=null || uri.getRawFragment()!=null || uri.getUserInfo()!=null)
            throw new IllegalStateException("Account mail public base URL must be an HTTP(S) origin");
        this.tokens=tokens;this.accounts=accounts;this.sessions=sessions;this.limits=limits;this.audit=audit;this.events=events;this.clock=clock;
        this.baseUrl=baseUrl.replaceAll("/+$","");
    }
    @Transactional
    public void requestReset(String email,String remoteAddress) {
        String normalized=AccountSecurityService.normalize(email);
        limits.admit("ip:"+remoteAddress,SecurityOperationLimiter.Operation.RESET_REQUEST);
        limits.admit("email:"+normalized,SecurityOperationLimiter.Operation.RESET_REQUEST);
        issue(normalized,MailSender.Purpose.RESET,Duration.ofMinutes(30),"/reset-password");
    }
    @Transactional
    public void requestVerification(UUID user) {
        limits.admit(user.toString(),SecurityOperationLimiter.Operation.VERIFY_REQUEST);
        var identity=accounts.require(user);
        if (identity.emailVerifiedAt()==null) issue(identity.normalizedEmail(),MailSender.Purpose.VERIFY,Duration.ofHours(24),"/verify-email");
    }
    private void issue(String email,MailSender.Purpose purpose,Duration lifetime,String path) {
        var token=SecureTokens.create();var now=clock.instant();
        tokens.create(email,purpose,SecureTokens.hash(token),now,now.plus(lifetime));
        events.publishEvent(new AccountMailRequested(email,purpose,baseUrl+path+"#"+token));
    }
    @Transactional
    public void reset(String token,String replacement,String remoteAddress) {
        limits.admit("ip:"+remoteAddress,SecurityOperationLimiter.Operation.RESET);
        if (!SecureTokens.valid(token)) throw invalid();
        var candidate=tokens.find(SecureTokens.hash(token),MailSender.Purpose.RESET).orElseThrow(AccountLifecycleService::invalid);
        var user=accounts.find(candidate.email()).orElseThrow(AccountLifecycleService::invalid);
        // Serialize resets and password changes for the account before acquiring any token row lock.
        accounts.lockForSecurity(user.id());
        var row=valid(token,MailSender.Purpose.RESET);
        accounts.resetPassword(user.id(),replacement); tokens.use(row.id(),clock.instant());
        tokens.invalidateResets(row.email(),clock.instant());
        sessions.revokeAll(user.id(),null); audit.record(user.id(),AccountAudit.Type.PASSWORD_RESET);
    }
    @Transactional
    public void verify(String token,UUID caller) {
        limits.admit(caller.toString(),SecurityOperationLimiter.Operation.VERIFY);
        var row=valid(token,MailSender.Purpose.VERIFY);var user=accounts.require(caller);
        if (!row.email().equals(user.normalizedEmail())) throw invalid();
        accounts.verifyEmail(caller);tokens.use(row.id(),clock.instant());audit.record(caller,AccountAudit.Type.EMAIL_VERIFIED);
    }
    private PostgresAccountTokenStore.Token valid(String token,MailSender.Purpose purpose) {
        if (!SecureTokens.valid(token)) throw invalid();
        var row=tokens.lock(SecureTokens.hash(token),purpose).orElseThrow(AccountLifecycleService::invalid);
        if (row.usedAt()!=null || !row.expiresAt().isAfter(clock.instant())) throw invalid();return row;
    }
    private static ApiException invalid() { return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Link is invalid or no longer available"); }
}
