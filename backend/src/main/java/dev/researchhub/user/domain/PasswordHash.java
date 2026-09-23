package dev.researchhub.user.domain;

/**
 * A stored password hash. Never a plaintext password.
 *
 * <p>This type exists so that "the user's password" is not representable in the domain at all. The
 * only way to build one is {@link #ofHash(String)}, whose contract is that the caller has already
 * run the value through the {@code auth} module's password encoder. There is no constructor, field,
 * or setter that takes a raw password, so no code path can accidentally persist one.
 *
 * <p>{@link #toString()} is redacted. A hash is not as dangerous as a plaintext password, but it is
 * still credential material and must not reach a log line, an exception message, or an API response
 * body. The value is only readable through {@link #value()}, which the persistence mapping calls
 * deliberately.
 *
 * <p>Hashing itself arrives with the login task, using {@code spring-security-crypto}. See
 * docs/adr/ADR-001-authentication.md.
 */
public record PasswordHash(String value) {

    /**
     * Wraps an already-hashed password.
     *
     * @param hash output of a password encoder, not a plaintext password
     * @throws IllegalArgumentException if the hash is null or blank
     */
    public static PasswordHash ofHash(String hash) {
        if (hash == null || hash.isBlank()) {
            throw new IllegalArgumentException(
                    "password hash must not be blank; an account must always have a usable credential");
        }
        return new PasswordHash(hash);
    }

    @Override
    public String toString() {
        return "PasswordHash[REDACTED]";
    }

}
