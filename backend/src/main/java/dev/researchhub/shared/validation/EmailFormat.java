package dev.researchhub.shared.validation;

import java.util.regex.Pattern;

/**
 * One email-shape rule, shared by request DTOs and by the domain type that stores an address.
 *
 * <p>It lives here, next to {@link FieldLengths}, for the same reason those constants do: a module's
 * API layer and another module's domain both need the rule, and duplicating the pattern would let the
 * two drift until a value passes validation at the boundary and is rejected deeper in, or the reverse.
 * This is a format helper, not a registration rule — who may register, and with what password, is not
 * decided here.
 *
 * <p>Deliberately not an RFC 5322 parser. It rejects what is certainly unusable — a missing
 * {@code @}, an empty local part or domain, internal whitespace, a domain with no dot — and leaves
 * anything subtler to the mail server that will eventually deliver to it. A stricter pattern rejects
 * real addresses, which is a worse failure than accepting an odd one.
 */
public final class EmailFormat {

    /**
     * Usable both as a {@link java.util.regex.Pattern} and as the {@code regexp} of a Bean Validation
     * {@code @Email}, which is why it is a plain string constant.
     */
    public static final String PATTERN = "[^\\s@]+@[^\\s@.]+(\\.[^\\s@.]+)+";

    public static final Pattern COMPILED = Pattern.compile(PATTERN);

    public static boolean isPlausible(String address) {
        return address != null && COMPILED.matcher(address).matches();
    }

    private EmailFormat() {
    }

}
