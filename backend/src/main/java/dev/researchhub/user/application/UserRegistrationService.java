package dev.researchhub.user.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.user.domain.PasswordHash;
import dev.researchhub.user.domain.User;
import dev.researchhub.user.domain.UserEmail;
import dev.researchhub.user.infrastructure.UserEntity;
import dev.researchhub.user.infrastructure.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;

/**
 * Creates user accounts.
 *
 * <p>Takes Spring Security's {@link PasswordEncoder} interface rather than anything from the
 * {@code auth} module, so hashing happens here — where the domain's {@link PasswordHash} can be
 * constructed — without {@code user} depending on {@code auth}. See
 * docs/development/backend-architecture.md.
 *
 * <p>Available in every product runtime; persistence dependencies must be configured at startup.
 *
 * <p>Deliberately <strong>not</strong> {@code @Transactional}. Registration writes exactly one row,
 * so the single insert is already atomic, and keeping the unique-constraint failure inside its own
 * transaction means catching it does not leave the caller holding a rollback-only transaction that
 * would fail on commit and turn a 409 into a 500.
 */
@Service
public class UserRegistrationService {

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final Clock clock;

    public UserRegistrationService(UserRepository users, PasswordEncoder passwordEncoder,
                                   PasswordPolicy passwordPolicy, Clock clock) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
        this.clock = clock;
    }

    /**
     * Registers a new account and returns its public metadata.
     *
     * @throws ApiException      {@code VALIDATION_FAILED} when the email or password breaks a rule.
     *                           The HTTP layer normally catches this first with Bean Validation and
     *                           produces field errors; this is the backstop for other callers.
     * @throws ConflictException when an account already uses the same normalized email
     */
    public UserAccount register(RegisterUserCommand command) {
        String passwordFailure = passwordPolicy.describeFailure(command.rawPassword());
        if (passwordFailure != null) {
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, passwordFailure);
        }

        UserEmail email = parseEmail(command.email());

        // Checked before the insert so the ordinary duplicate case never dirties a transaction.
        // The unique index below is still the authority: this check can lose a race.
        if (users.existsByNormalizedEmail(email.normalized())) {
            throw new ConflictException("An account with this email already exists");
        }

        Instant now = clock.instant();
        String hash = passwordEncoder.encode(command.rawPassword());
        User user = User.register(email, PasswordHash.ofHash(hash), command.displayName(), now);

        try {
            return UserAccount.from(users.saveAndFlush(UserEntity.fromDomain(user)).toDomain());
        } catch (DataIntegrityViolationException raceLost) {
            // Two concurrent registrations for the same address: uq_users_normalized_email rejected
            // this one. Same answer as the pre-check, so the client cannot tell the difference and
            // cannot use timing to probe which addresses exist.
            throw new ConflictException("An account with this email already exists");
        }
    }

    private static UserEmail parseEmail(String rawEmail) {
        try {
            return UserEmail.of(rawEmail);
        } catch (IllegalArgumentException invalid) {
            // The domain message is written for a user and contains no password material.
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED, invalid.getMessage());
        }
    }

}
