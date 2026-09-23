package dev.researchhub.user.application;

/**
 * Input to {@link UserRegistrationService#register}.
 *
 * <p>{@code rawPassword} is a plaintext password and exists only for the duration of the call. It is
 * hashed inside the service and never stored on a domain object, returned, or logged.
 */
public record RegisterUserCommand(String email, String rawPassword, String displayName) {

    @Override
    public String toString() {
        // Prevents the password reaching a log line or an exception message through an accidental
        // string concatenation of the command.
        return "RegisterUserCommand[email=" + email + ", displayName=" + displayName
                + ", rawPassword=REDACTED]";
    }

}
