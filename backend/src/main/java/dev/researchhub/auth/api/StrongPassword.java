package dev.researchhub.auth.api;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Checks a password against the configured policy.
 *
 * <p>A plain {@code @Size(min = ...)} cannot express this: the minimum comes from
 * {@code researchhub.auth.password.min-length} at runtime, and an annotation attribute has to be a
 * compile-time constant. Putting the number in an annotation would also mean two places to change it.
 * A validator reads the one policy object instead, so the DTO check and the service check can never
 * disagree.
 */
@Documented
@Constraint(validatedBy = StrongPasswordValidator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface StrongPassword {

    /** Unused: the validator supplies a message naming the rule that failed. */
    String message() default "password does not meet the policy";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

}
