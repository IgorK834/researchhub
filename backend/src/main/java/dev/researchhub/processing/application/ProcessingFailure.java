package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJobError;

import java.util.Objects;

/** Safe failure data delivered across module boundaries; it never contains a stack trace. */
public record ProcessingFailure(String code, String message) {
    public ProcessingFailure {
        Objects.requireNonNull(code, "code");
        Objects.requireNonNull(message, "message");
    }

    public static ProcessingFailure from(ProcessingJobError error) {
        return new ProcessingFailure(error.code(), error.message());
    }
}
