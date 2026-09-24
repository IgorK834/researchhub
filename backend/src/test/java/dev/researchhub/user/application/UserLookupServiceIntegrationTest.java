package dev.researchhub.user.application;

import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.user.domain.PasswordHash;
import dev.researchhub.user.domain.User;
import dev.researchhub.user.domain.UserEmail;
import dev.researchhub.user.domain.UserStatus;
import dev.researchhub.user.infrastructure.UserEntity;
import dev.researchhub.user.infrastructure.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The exact-email lookup another module uses to add a workspace member.
 *
 * <p>Two properties matter here, and they pull in opposite directions. It has to find the account when the
 * address is typed with different casing or stray spaces, because that is the same address. And it must not
 * become a way to ask questions about accounts: no partial match, no listing, and one empty answer for every
 * reason a lookup fails.
 */
@PostgresIntegrationTest
class UserLookupServiceIntegrationTest {

    private static final String HASH = "{bcrypt}$2a$10$7EqJtq98hPqEX7fNZaFWoOa1u9Nm.pJ0tLpHqcSEcBTzuHRz9Bq0e";
    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    @Autowired
    private UserLookupService lookup;

    @Autowired
    private UserRepository users;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @PersistenceContext
    private EntityManager entityManager;

    private UUID insertUser(String email, String displayName) {
        User user = User.register(UserEmail.of(email), PasswordHash.ofHash(HASH), displayName, NOW);
        return users.saveAndFlush(UserEntity.fromDomain(user)).getId();
    }

    /**
     * Disables or locks an account with SQL, because nothing in the domain does it yet.
     *
     * <p>The persistence context is cleared afterwards. Without that, Hibernate would keep serving the
     * instance it loaded on insert and the lookup would still see {@code ACTIVE} — the test would pass or
     * fail on a stale in-memory copy rather than on the row.
     */
    private void setStatus(UUID userId, UserStatus status) {
        jdbcTemplate.update("UPDATE users SET status = ? WHERE id = ?", status.name(), userId);
        entityManager.clear();
    }

    @Test
    void findsAnActiveUserByTheirExactAddress() {
        UUID adaId = insertUser("ada@example.com", "Ada Lovelace");

        UserAccount found = lookup.findActiveByEmail("ada@example.com").orElseThrow();

        assertEquals(adaId, found.id());
        assertEquals("ada@example.com", found.email());
        assertEquals("Ada Lovelace", found.displayName());
    }

    @Test
    void ignoresCasingAndSurroundingWhitespace() {
        insertUser("Ada.Lovelace@Example.com", "Ada Lovelace");

        assertTrue(lookup.findActiveByEmail("  ADA.LOVELACE@example.COM  ").isPresent(),
                "The same address typed differently is the same account, as the unique index agrees");
        assertEquals("Ada.Lovelace@Example.com",
                lookup.findActiveByEmail("ada.lovelace@example.com").orElseThrow().email(),
                "and the address comes back with the casing its owner chose");
    }

    @Test
    void doesNotMatchOnPartOfAnAddress() {
        insertUser("ada@example.com", "Ada Lovelace");

        assertTrue(lookup.findActiveByEmail("ada").isEmpty());
        assertTrue(lookup.findActiveByEmail("ada@example.co").isEmpty());
        assertTrue(lookup.findActiveByEmail("%@example.com").isEmpty(),
                "The address is a key, not a pattern: this must not become user search");
    }

    @Test
    void answersEmptyForEveryKindOfFailureAlike() {
        UUID disabledId = insertUser("disabled@example.com", "Disabled Account");
        setStatus(disabledId, UserStatus.DISABLED);
        UUID lockedId = insertUser("locked@example.com", "Locked Account");
        setStatus(lockedId, UserStatus.LOCKED);

        // A caller cannot tell these four apart, which is what stops the add-member endpoint from
        // reporting which addresses have accounts.
        assertTrue(lookup.findActiveByEmail("nobody@example.com").isEmpty(), "unknown");
        assertTrue(lookup.findActiveByEmail("not-an-email").isEmpty(), "malformed");
        assertTrue(lookup.findActiveByEmail("   ").isEmpty(), "blank");
        assertTrue(lookup.findActiveByEmail(null).isEmpty(), "absent");
        assertTrue(lookup.findActiveByEmail("disabled@example.com").isEmpty(), "disabled account");
        assertTrue(lookup.findActiveByEmail("locked@example.com").isEmpty(), "locked account");
    }

    @Test
    void findsTheAccountsForASetOfIds() {
        UUID adaId = insertUser("ada@example.com", "Ada Lovelace");
        UUID kasiaId = insertUser("kasia@example.com", "Kasia Nowak");
        insertUser("outsider@example.com", "Somebody Else");

        List<UUID> found = lookup.findAllByIds(List.of(adaId, kasiaId)).stream()
                .map(UserAccount::id)
                .toList();

        assertEquals(2, found.size(), "Only the ids asked for");
        assertTrue(found.containsAll(List.of(adaId, kasiaId)));
    }

    @Test
    void returnsNothingForNoIdsRatherThanEveryUser() {
        insertUser("ada@example.com", "Ada Lovelace");

        assertEquals(List.of(), lookup.findAllByIds(List.of()),
                "A workspace with no members asks for no ids and must not receive the user table");
        assertEquals(List.of(), lookup.findAllByIds(null));
    }

    @Test
    void includesAMemberWhoseAccountWasDisabled() {
        UUID disabledId = insertUser("disabled@example.com", "Disabled Account");
        setStatus(disabledId, UserStatus.DISABLED);

        assertEquals(1, lookup.findAllByIds(List.of(disabledId)).size(),
                "A disabled account is still a member, so a roster that dropped them would be wrong");
    }

    @Test
    void exposesNoCredentialMaterial() {
        UUID adaId = insertUser("ada@example.com", "Ada Lovelace");

        UserAccount account = lookup.findAllByIds(List.of(adaId)).getFirst();

        assertEquals(4, UserAccount.class.getRecordComponents().length,
                "UserAccount is id, email, displayName, and status. A new field here reaches every caller.");
        assertTrue(account.toString().contains("ada@example.com"));
        assertTrue(!account.toString().contains(HASH), "and never the password hash");
    }

}
