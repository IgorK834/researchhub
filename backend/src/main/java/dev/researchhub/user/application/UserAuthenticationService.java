package dev.researchhub.user.application;

import dev.researchhub.user.domain.UserStatus;
import dev.researchhub.user.infrastructure.UserEntity;
import dev.researchhub.user.infrastructure.UserRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Verifies credentials and loads the current user.
 *
 * <p>Every rejection is indistinguishable from the outside: this class returns an empty
 * {@link Optional} whether the address is unknown, the password is wrong, or the account is not
 * {@link UserStatus#ACTIVE}. It never explains which. A caller that reported "no such user"
 * separately from "wrong password" would turn the login form into an account-enumeration oracle.
 *
 * <p>Active on the {@code local} profile only, for the same reason as
 * {@link UserRegistrationService}: {@link UserRepository} exists only where JPA is configured.
 */
@Service
@Profile("local")
public class UserAuthenticationService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;

    public UserAuthenticationService(UserRepository users, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Checks an email and password.
     *
     * @param rawPassword plaintext password; used only to compare against the stored hash
     * @return the account when the credentials are right and the account may sign in, otherwise empty
     */
    @Transactional(readOnly = true)
    public Optional<UserAccount> authenticate(String rawEmail, String rawPassword) {
        String normalized = normalize(rawEmail);
        if (normalized == null || rawPassword == null || rawPassword.isEmpty()) {
            return Optional.empty();
        }

        Optional<UserEntity> found = users.findByNormalizedEmail(normalized);

        if (found.isEmpty()) {
            // Hash anyway. Verifying a BCrypt hash costs far more than a failed lookup, so returning
            // early here would make "unknown address" measurably faster than "wrong password" and
            // hand out account existence through response timing.
            passwordEncoder.matches(rawPassword, DUMMY_HASH);
            return Optional.empty();
        }

        UserEntity entity = found.get();
        if (!passwordEncoder.matches(rawPassword, entity.getPasswordHash())) {
            return Optional.empty();
        }
        if (entity.getStatus() != UserStatus.ACTIVE) {
            return Optional.empty();
        }

        return Optional.of(UserAccount.from(entity.toDomain()));
    }

    /**
     * Loads the user a live session belongs to.
     *
     * <p>Read fresh on every request rather than trusted from the session, so disabling or locking an
     * account takes effect immediately instead of at session expiry. An account that is no longer
     * {@link UserStatus#ACTIVE} returns empty, which the HTTP layer turns into a 401.
     */
    @Transactional(readOnly = true)
    public Optional<UserAccount> findActiveById(UUID id) {
        if (id == null) {
            return Optional.empty();
        }
        return users.findById(id)
                .filter(entity -> entity.getStatus() == UserStatus.ACTIVE)
                .map(entity -> UserAccount.from(entity.toDomain()));
    }

    private static String normalize(String rawEmail) {
        if (rawEmail == null) {
            return null;
        }
        String trimmed = rawEmail.strip();
        return trimmed.isEmpty() ? null : trimmed.toLowerCase(Locale.ROOT);
    }

    /**
     * A real BCrypt hash of a value nobody uses, so the equal-cost comparison above does the same
     * work as a genuine verification. Not a credential: nothing accepts the password behind it.
     */
    private static final String DUMMY_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

}
