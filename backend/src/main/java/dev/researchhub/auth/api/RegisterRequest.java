package dev.researchhub.auth.api;

import dev.researchhub.shared.validation.EmailFormat;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/auth/register}.
 *
 * <p>{@code email} and {@code displayName} are trimmed in the compact constructor, before Bean
 * Validation runs, so a whitespace-only value is rejected as blank rather than stored as invisible
 * content (docs/development/validation.md).
 *
 * <p>{@code password} is deliberately <strong>not</strong> trimmed. A leading or trailing space is a
 * legitimate character in a password, and silently removing it would change the credential the user
 * chose and lock them out of the account they thought they created.
 */
public record RegisterRequest(
        @NotBlank
        @Email(regexp = EmailFormat.PATTERN)
        @Size(max = FieldLengths.EMAIL_MAX)
        String email,

        @StrongPassword
        String password,

        @NotBlank
        @Size(max = FieldLengths.NAME_MAX)
        String displayName
) {

    public RegisterRequest {
        email = Normalize.trim(email);
        displayName = Normalize.trim(displayName);
    }

    @Override
    public String toString() {
        return "RegisterRequest[email=" + email + ", displayName=" + displayName
                + ", password=REDACTED]";
    }

}
