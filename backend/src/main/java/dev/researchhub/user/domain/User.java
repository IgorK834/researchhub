package dev.researchhub.user.domain;

import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A ResearchHub identity.
 *
 * <p>Invariants enforced here, independently of any request DTO, because not every caller arrives
 * through a validated controller (see docs/development/validation.md):
 *
 * <ul>
 *   <li>the email is present and carries its normal form ({@link UserEmail}),
 *   <li>a credential is present and is a hash, never a plaintext password ({@link PasswordHash}),
 *   <li>the display name is present, trimmed, and within {@link FieldLengths#NAME_MAX},
 *   <li>the status is one of {@link UserStatus}.
 * </ul>
 *
 * <p>{@code id} is null for a user that has not been persisted yet: {@link #register} produces that
 * state, and Hibernate assigns the identifier on insert. A user read back from the database always
 * has one. The generation strategy is documented in docs/development/persistence.md.
 *
 * <p>Uniqueness of the email is <em>not</em> an invariant of this type. A single object cannot know
 * whether another row already uses the address, so that rule belongs to the unique index on
 * {@code users.normalized_email}.
 */
public record User(
        UUID id,
        UserEmail email,
        PasswordHash passwordHash,
        String displayName,
        UserStatus status,
        Instant createdAt,
        Instant updatedAt
) {

    public User {
        Objects.requireNonNull(email, "email must not be null");
        Objects.requireNonNull(passwordHash, "password hash must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");

        displayName = Normalize.trim(displayName);
        if (displayName == null || displayName.isBlank()) {
            throw new IllegalArgumentException("display name must not be blank");
        }
        if (displayName.length() > FieldLengths.NAME_MAX) {
            throw new IllegalArgumentException(
                    "display name must be at most " + FieldLengths.NAME_MAX + " characters");
        }
    }

    /**
     * Creates a user that has not been persisted yet, as {@link UserStatus#ACTIVE}.
     *
     * <p>{@code now} is passed in rather than read from a clock inside the domain, so the timestamps
     * are deterministic in tests.
     *
     * @param passwordHash an already-hashed password; this method never accepts plaintext
     */
    public static User register(UserEmail email, PasswordHash passwordHash, String displayName, Instant now) {
        return new User(null, email, passwordHash, displayName, UserStatus.ACTIVE, now, now);
    }

    /** True once this user has a database identity. */
    public boolean isPersisted() {
        return id != null;
    }

}
