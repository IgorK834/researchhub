package dev.researchhub.user.infrastructure;

import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.user.domain.PasswordHash;
import dev.researchhub.user.domain.User;
import dev.researchhub.user.domain.UserEmail;
import dev.researchhub.user.domain.UserStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the {@code users} table behaves as docs/development/persistence.md and
 * V2__create_users.sql promise: uniqueness is decided on the normalized email, and the stored
 * credential is a hash.
 *
 * <p>Runs against PostgreSQL 17 in Testcontainers, so the assertions exercise the real unique index
 * and check constraints rather than Hibernate's in-memory view of them.
 */
@PostgresIntegrationTest
class UserRepositoryIntegrationTest {

    /** Stand-in for encoder output. A real hash arrives with the login task. */
    private static final String HASH = "{bcrypt}$2a$10$7EqJtq98hPqEX7fNZaFWoOa1u9Nm.pJ0tLpHqcSEcBTzuHRz9Bq0e";

    /** Never stored. Used only to assert the column does not contain it. */
    private static final String PLAINTEXT_PASSWORD = "correct-horse-battery-staple";

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    @Autowired
    private UserRepository users;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private static User newUser(String email, String displayName) {
        return User.register(UserEmail.of(email), PasswordHash.ofHash(HASH), displayName, NOW);
    }

    @Test
    void savesAUserAndAssignsAUuid() {
        UserEntity saved = users.saveAndFlush(UserEntity.fromDomain(newUser("ada@example.com", "Ada Lovelace")));

        assertNotNull(saved.getId(), "Hibernate should assign the UUID on insert");
        assertEquals("ada@example.com", saved.getEmail());
        assertEquals("ada@example.com", saved.getNormalizedEmail());
        assertEquals(UserStatus.ACTIVE, saved.getStatus());
    }

    @Test
    void preservesTheEnteredCasingWhileNormalizingForUniqueness() {
        UserEntity saved = users.saveAndFlush(
                UserEntity.fromDomain(newUser("  Ada.Lovelace@Example.COM  ", "Ada Lovelace")));

        assertEquals("Ada.Lovelace@Example.COM", saved.getEmail(),
                "The address is stored trimmed but with the casing the user typed");
        assertEquals("ada.lovelace@example.com", saved.getNormalizedEmail(),
                "The normal form is trimmed and lowercased");
    }

    @Test
    void rejectsASecondUserWhoseEmailDiffersOnlyByCase() {
        users.saveAndFlush(UserEntity.fromDomain(newUser("ada@example.com", "Ada Lovelace")));

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> users.saveAndFlush(UserEntity.fromDomain(newUser("ADA@Example.com", "Impostor"))),
                "A duplicate normalized email must be rejected by the database");

        assertTrue(failure.getMessage().contains("uq_users_normalized_email"),
                "The failure should come from the normalized_email unique constraint, but was: "
                        + failure.getMessage());
    }

    @Test
    void rejectsASecondUserWhoseEmailDiffersOnlyBySurroundingWhitespace() {
        users.saveAndFlush(UserEntity.fromDomain(newUser("grace@example.com", "Grace Hopper")));

        assertThrows(DataIntegrityViolationException.class,
                () -> users.saveAndFlush(UserEntity.fromDomain(newUser("   grace@example.com   ", "Impostor"))),
                "Surrounding whitespace must not create a second account");
    }

    @Test
    void storesTheSuppliedHashAndNeverThePlaintextPassword() {
        UUID id = users.saveAndFlush(
                UserEntity.fromDomain(newUser("alan@example.com", "Alan Turing"))).getId();

        String storedHash = jdbcTemplate.queryForObject(
                "SELECT password_hash FROM users WHERE id = ?", String.class, id);

        assertEquals(HASH, storedHash, "The column should hold exactly the hash that was supplied");
        assertNotEquals(PLAINTEXT_PASSWORD, storedHash, "A plaintext password must never be stored");

        Integer plaintextRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM users WHERE password_hash = ?", Integer.class, PLAINTEXT_PASSWORD);
        assertEquals(0, plaintextRows, "No row may contain the plaintext password");
    }

    @Test
    void hasNoPasswordColumn() {
        Integer passwordColumns = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'password'
                """, Integer.class);

        assertEquals(0, passwordColumns, "The table must store a hash only, so there is no password column");
    }

    @Test
    void findsAUserByTheNormalizedEmailRegardlessOfTypedCasing() {
        users.saveAndFlush(UserEntity.fromDomain(newUser("Katherine@Example.com", "Katherine Johnson")));

        assertTrue(users.findByNormalizedEmail("katherine@example.com").isPresent());
        assertTrue(users.existsByNormalizedEmail("katherine@example.com"));
        assertTrue(users.findByNormalizedEmail("Katherine@Example.com").isEmpty(),
                "Lookups go through the normal form, so a raw address is not a key");
    }

}
