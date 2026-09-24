package dev.researchhub.document.api;

import dev.researchhub.shared.validation.FieldLengths;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;

/**
 * Checks that submitted content is a JSON object of an acceptable size.
 *
 * <p>Runs on the already-parsed node, so "is this an object" costs nothing: Jackson has done the parsing to get
 * here, and a body that is not JSON at all never reaches validation — the message converter rejects it as
 * {@code MALFORMED_REQUEST} first.
 *
 * <p>Follows the {@code StrongPasswordValidator} pattern of replacing the default message with the specific
 * rule that failed, so a client can tell "that is an array" from "that is too large" instead of receiving one
 * vague refusal for both.
 */
public class JsonDocumentContentValidator implements ConstraintValidator<JsonDocumentContent, JsonNode> {

    @Override
    public boolean isValid(JsonNode content, ConstraintValidatorContext context) {
        if (content == null) {
            // Presence is @NotNull's business. Reporting it here too would produce two errors for one mistake.
            return true;
        }

        if (!content.isObject()) {
            return reject(context, "must be a JSON object, not "
                    + content.getNodeType().name().toLowerCase(java.util.Locale.ROOT));
        }

        int bytes = content.toString().getBytes(StandardCharsets.UTF_8).length;
        if (bytes > FieldLengths.DOCUMENT_CONTENT_MAX_BYTES) {
            return reject(context, "must be at most " + FieldLengths.DOCUMENT_CONTENT_MAX_BYTES
                    + " bytes, but was " + bytes);
        }

        return true;
    }

    private static boolean reject(ConstraintValidatorContext context, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message).addConstraintViolation();
        return false;
    }

}
