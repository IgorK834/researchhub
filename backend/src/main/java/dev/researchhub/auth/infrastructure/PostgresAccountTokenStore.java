package dev.researchhub.auth.infrastructure;

import dev.researchhub.auth.application.MailSender.Purpose;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public class PostgresAccountTokenStore {
    public record Token(UUID id,String email,Purpose purpose,Instant expiresAt,Instant usedAt) {}
    private final JdbcTemplate jdbc;
    public PostgresAccountTokenStore(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public void create(String email,Purpose purpose,String hash,Instant now,Instant expires) {
        jdbc.update("INSERT INTO account_lifecycle_token(id,email_normalized,purpose,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)",
            UUID.randomUUID(),email,purpose.name(),hash,Timestamp.from(now),Timestamp.from(expires));
    }
    public Optional<Token> find(String hash,Purpose purpose) { return query(hash,purpose,false); }
    public Optional<Token> lock(String hash,Purpose purpose) { return query(hash,purpose,true); }
    private Optional<Token> query(String hash,Purpose purpose,boolean lock) {
        return jdbc.query("SELECT * FROM account_lifecycle_token WHERE token_hash=? AND purpose=?"+(lock?" FOR UPDATE":""),(rs,i) -> {
            var used=rs.getTimestamp("used_at");
            return new Token(rs.getObject("id",UUID.class),rs.getString("email_normalized"),Purpose.valueOf(rs.getString("purpose")),
                rs.getTimestamp("expires_at").toInstant(),used==null?null:used.toInstant());
        },hash,purpose.name()).stream().findFirst();
    }
    public void invalidateResets(String email,Instant now) {
        jdbc.update("UPDATE account_lifecycle_token SET used_at=? WHERE email_normalized=? AND purpose='RESET' AND used_at IS NULL",Timestamp.from(now),email);
    }
    public void use(UUID id,Instant now) { jdbc.update("UPDATE account_lifecycle_token SET used_at=? WHERE id=?",Timestamp.from(now),id); }
}
