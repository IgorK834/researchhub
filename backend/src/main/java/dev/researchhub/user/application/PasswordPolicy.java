package dev.researchhub.user.application;

import java.nio.charset.StandardCharsets;

/**
 * The single place that decides whether a raw password is acceptable.
 *
 * <p>Configured by {@code researchhub.auth.password.min-length} (default 12). The property is
 * namespaced under {@code auth} because password rules belong to the authentication feature, while
 * this type lives in {@code user.application} because that is the layer both the {@code auth}
 * request DTO validator and {@link UserRegistrationService} may legally depend on. See
 * docs/development/backend-architecture.md.
 *
 * <p><strong>BCrypt truncation.</strong> BCrypt hashes at most the first 72 bytes of the input and
 * silently ignores the rest. Two passwords sharing a 72-byte prefix therefore verify against the
 * same hash. Because bytes are not characters, a password well under 72 characters can still exceed
 * 72 bytes once non-ASCII is encoded as UTF-8. Rather than truncate silently, a password longer than
 * that limit is rejected, so no user ends up with a credential whose tail does not matter. This is
 * also why the maximum is a security rule rather than a column-width concern.
 */
public final class PasswordPolicy {

    /**
     * BCrypt's input limit in bytes. Not configurable: it is a property of the algorithm, not a
     * preference.
     */
    public static final int BCRYPT_MAX_BYTES = 72;

    private final int minLength;

    public PasswordPolicy(int minLength) {
        if (minLength < 1) {
            throw new IllegalArgumentException("password min-length must be at least 1");
        }
        this.minLength = minLength;
    }

    public int minLength() {
        return minLength;
    }

    /** True when the password satisfies every rule below. */
    public boolean isAcceptable(String rawPassword) {
        return describeFailure(rawPassword) == null;
    }

    /**
     * Returns a message safe to show the user, or {@code null} when the password is acceptable.
     *
     * <p>The message never contains the password.
     */
    public String describeFailure(String rawPassword) {
        if (rawPassword == null || rawPassword.isEmpty()) {
            return "password must not be blank";
        }
        if (rawPassword.length() < minLength) {
            return "password must be at least " + minLength + " characters";
        }
        if (rawPassword.getBytes(StandardCharsets.UTF_8).length > BCRYPT_MAX_BYTES) {
            return "password must be at most " + BCRYPT_MAX_BYTES + " bytes";
        }
        return null;
    }

}
