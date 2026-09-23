package dev.researchhub.auth.api;

import dev.researchhub.user.application.PasswordPolicy;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * Turns a {@link PasswordPolicy} failure into a field error on {@code password}.
 *
 * <p>Spring constructs Bean Validation validators as beans, so the policy can be injected and the DTO
 * reports the same rule the registration service enforces.
 */
public class StrongPasswordValidator implements ConstraintValidator<StrongPassword, String> {

    private final PasswordPolicy passwordPolicy;

    public StrongPasswordValidator(PasswordPolicy passwordPolicy) {
        this.passwordPolicy = passwordPolicy;
    }

    @Override
    public boolean isValid(String rawPassword, ConstraintValidatorContext context) {
        String failure = passwordPolicy.describeFailure(rawPassword);
        if (failure == null) {
            return true;
        }

        // Replace the default message with the specific rule that failed, so the client can show
        // "must be at least 12 characters" rather than a generic refusal. The policy's messages are
        // fixed literals and never contain the password.
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(failure).addConstraintViolation();
        return false;
    }

}
