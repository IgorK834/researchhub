package dev.researchhub.processing.domain;

import java.util.Objects;
import java.util.regex.Pattern;

/** A bounded, user-safe failure summary. Exception text and stack traces never enter this value. */
public record ProcessingJobError(String code, String message) {

    public static final int CODE_MAX_LENGTH = 64;
    public static final int MESSAGE_MAX_LENGTH = 500;
    private static final Pattern CODE = Pattern.compile("^[A-Z][A-Z0-9_]{0,63}$");

    public ProcessingJobError {
        code = Objects.requireNonNull(code, "code").strip();
        message = Objects.requireNonNull(message, "message").strip();
        if (!CODE.matcher(code).matches()) {
            throw new IllegalArgumentException("an error code must be uppercase snake case and at most 64 characters");
        }
        if (message.isEmpty() || message.length() > MESSAGE_MAX_LENGTH) {
            throw new IllegalArgumentException("an error message must contain 1 to 500 characters");
        }
    }
}
