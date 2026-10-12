package dev.researchhub.auth.application;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.sql.Timestamp;
import java.util.UUID;

@Service
public class AccountAudit {
    public enum Type { PASSWORD_CHANGED, SESSION_REVOKED, SESSIONS_REVOKED, SESSIONS_VIEWED, PASSWORD_RESET, EMAIL_VERIFIED }
    private final JdbcTemplate jdbc;
    private final Clock clock;
    public AccountAudit(JdbcTemplate jdbc,Clock clock) { this.jdbc=jdbc;this.clock=clock; }
    @Transactional(propagation=Propagation.MANDATORY)
    public void record(UUID user,Type type) {
        jdbc.update("INSERT INTO account_audit_events(id,user_id,event_type,created_at) VALUES (?,?,?,?)",
            UUID.randomUUID(),user,type.name(),Timestamp.from(clock.instant()));
    }
}
