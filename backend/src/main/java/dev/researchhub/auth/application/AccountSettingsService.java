package dev.researchhub.auth.application;

import dev.researchhub.user.application.AccountSecurityService;
import dev.researchhub.security.application.SecurityOperationLimiter;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.UUID;

@Service
public class AccountSettingsService {
    private final AccountSecurityService accounts;
    private final AccountSessionService sessions;
    private final SecurityOperationLimiter limits;
    private final AccountAudit audit;
    private final java.time.Clock clock;
    private final dev.researchhub.auth.infrastructure.PostgresAccountTokenStore tokens;
    public AccountSettingsService(AccountSecurityService accounts,AccountSessionService sessions,SecurityOperationLimiter limits,AccountAudit audit,dev.researchhub.auth.infrastructure.PostgresAccountTokenStore tokens,java.time.Clock clock) {
        this.accounts=accounts;this.sessions=sessions;this.limits=limits;this.audit=audit;this.tokens=tokens;this.clock=clock;
    }
    @Transactional
    public void password(UUID user,String current,String replacement,String currentSession) {
        limits.admit(user.toString(),SecurityOperationLimiter.Operation.PASSWORD);
        accounts.changePassword(user,current,replacement);
        tokens.invalidateResets(accounts.require(user).normalizedEmail(),clock.instant());
        sessions.revokeAll(user,currentSession); audit.record(user,AccountAudit.Type.PASSWORD_CHANGED);
    }
    @Transactional
    public List<AccountSessionService.Summary> sessions(UUID user,String currentSession) {
        limits.admit(user.toString(),SecurityOperationLimiter.Operation.SESSIONS); var result=sessions.list(user,currentSession); audit.record(user,AccountAudit.Type.SESSIONS_VIEWED); return result;
    }
    @Transactional
    public boolean revoke(UUID user,String handle,String currentSession) {
        limits.admit(user.toString(),SecurityOperationLimiter.Operation.SESSIONS);
        boolean current=sessions.revoke(user,handle,currentSession); audit.record(user,AccountAudit.Type.SESSION_REVOKED); return current;
    }
    @Transactional
    public void revokeAll(UUID user) {
        limits.admit(user.toString(),SecurityOperationLimiter.Operation.SESSIONS);
        sessions.revokeAll(user,null); audit.record(user,AccountAudit.Type.SESSIONS_REVOKED);
    }
}
