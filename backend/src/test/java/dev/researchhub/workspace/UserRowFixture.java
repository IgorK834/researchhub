package dev.researchhub.workspace;

import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.UUID;

/**
 * Inserts the {@code users} rows that workspace foreign keys require.
 *
 * <p>Writes SQL directly rather than going through the {@code user} module's repository and domain
 * types. {@code workspaces.created_by} and {@code workspace_members.user_id} need a real identity to
 * point at and nothing more, so the workspace tests stay independent of the user module's Java API —
 * the same separation the production code keeps by storing bare {@link UUID} columns.
 */
public final class UserRowFixture {

    /** Stand-in for password encoder output. No test here cares what it is. */
    private static final String HASH = "{bcrypt}$2a$10$7EqJtq98hPqEX7fNZaFWoOa1u9Nm.pJ0tLpHqcSEcBTzuHRz9Bq0e";

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    /** Inserts an active user and returns its id. */
    public static UUID insertUser(JdbcTemplate jdbcTemplate, String email, String displayName) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO users
                    (id, email, normalized_email, password_hash, display_name, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                """, id, email, email.toLowerCase(Locale.ROOT), HASH, displayName,
                timestamp(NOW), timestamp(NOW));
        return id;
    }

    /**
     * Binds an {@link Instant} to a {@code timestamptz} parameter.
     *
     * <p>The PostgreSQL driver refuses an {@code Instant} directly — it cannot infer which SQL type was
     * meant — so a raw JDBC insert has to hand it an {@link OffsetDateTime}. Hibernate does this
     * conversion for the entities; only hand-written SQL in tests needs it. UTC because that is the JDBC
     * time zone the local profile sets and what {@code Clock.systemUTC()} produces.
     */
    public static OffsetDateTime timestamp(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    /**
     * Removes every row the workspace tests create, children first so the foreign keys hold.
     *
     * <p>For tests that are not {@code @Transactional} and therefore do not roll back.
     */
    public static void deleteWorkspaceAndUserRows(JdbcTemplate jdbcTemplate) {
        jdbcTemplate.execute("DELETE FROM workspace_members");
        jdbcTemplate.execute("DELETE FROM workspaces");
        jdbcTemplate.execute("DELETE FROM users");
    }

    private UserRowFixture() {
    }

}
