package dev.researchhub.user.domain;

import dev.researchhub.shared.validation.EmailFormat;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;

import java.util.Locale;
import java.util.Objects;

/**
 * An email address together with the normal form that decides account uniqueness.
 *
 * <p>{@link #value()} is the address as entered, trimmed, so display and outgoing mail keep the
 * capitalisation the user chose. {@link #normalized()} is that value lowercased, and it is the only
 * thing uniqueness is decided on: {@code Ada@Example.com} and {@code  ada@example.com } are the same
 * account.
 *
 * <p>Lowercasing uses {@link Locale#ROOT} on purpose. {@code String.toLowerCase()} without a locale
 * follows the JVM default, and in a Turkish locale {@code I} lowercases to a dotless {@code ı}, so
 * the same address would normalize differently depending on where the server runs. That would let a
 * duplicate account slip past the unique index.
 *
 * <p>The database enforces the uniqueness rule on {@code normalized_email}; this type only
 * guarantees the value stored there really is the normal form. See
 * docs/development/persistence.md.
 */
public record UserEmail(String value, String normalized) {

    public UserEmail {
        Objects.requireNonNull(value, "email must not be null");
        Objects.requireNonNull(normalized, "normalized email must not be null");
    }

    /**
     * Builds an email from user input, trimming it and deriving the normal form.
     *
     * @throws IllegalArgumentException if the address is null, blank, longer than
     *                                  {@link FieldLengths#EMAIL_MAX}, or not a plausible address
     */
    public static UserEmail of(String rawEmail) {
        String trimmed = Normalize.trim(rawEmail);
        if (trimmed == null || trimmed.isBlank()) {
            throw new IllegalArgumentException("email must not be blank");
        }
        if (trimmed.length() > FieldLengths.EMAIL_MAX) {
            throw new IllegalArgumentException(
                    "email must be at most " + FieldLengths.EMAIL_MAX + " characters");
        }
        // The request DTO also carries @Email with the same pattern, for a field-level 400. This is
        // the backstop for callers that never pass through a controller, per validation.md.
        if (!EmailFormat.isPlausible(trimmed)) {
            throw new IllegalArgumentException("email must be a valid address");
        }
        return new UserEmail(trimmed, trimmed.toLowerCase(Locale.ROOT));
    }

}
