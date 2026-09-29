package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJobError;

/** Keeps a safe persisted summary separate from the detailed exception retained in server logs. */
public class WorkerDispatchException extends RuntimeException {

    private final ProcessingJobError safeError;

    public WorkerDispatchException(ProcessingJobError safeError, Throwable cause) {
        super("Processing worker dispatch failed", cause);
        this.safeError = safeError;
    }

    public ProcessingJobError safeError() {
        return safeError;
    }
}
