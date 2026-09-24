package dev.researchhub.document.api;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.ANNOTATION_TYPE;
import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.RECORD_COMPONENT;

/**
 * The annotated value must be a JSON <em>object</em> within the document content size limit.
 *
 * <p>Both halves of that are checked here, at the boundary, so a client gets a field error naming
 * {@code content} rather than a general failure. Neither check is only here: {@code DocumentContent} enforces
 * the size for every caller, and {@code ck_documents_content_is_object} and
 * {@code ck_documents_content_size} are what actually guarantee both in the column. This is the fast, specific
 * answer, not the authority.
 *
 * <p>A null value passes, so presence is {@code @NotNull}'s job and a missing body produces one error rather
 * than two.
 */
@Target({FIELD, PARAMETER, RECORD_COMPONENT, ANNOTATION_TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = JsonDocumentContentValidator.class)
@Documented
public @interface JsonDocumentContent {

    String message() default "must be a JSON object";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

}
