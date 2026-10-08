package dev.researchhub.user.infrastructure;

import dev.researchhub.user.application.RegistrationRejectionAudit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class PostgresRegistrationRejectionAudit implements RegistrationRejectionAudit {
    private final JdbcTemplate jdbc;
    public PostgresRegistrationRejectionAudit(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void rejected(String requestId, String mode) {
        jdbc.update("INSERT INTO registration_rejections(request_id,mode) VALUES (?,?)", requestId, mode);
    }
}
