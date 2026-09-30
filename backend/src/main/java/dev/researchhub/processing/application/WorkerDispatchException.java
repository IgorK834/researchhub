package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJobError;

/** Keeps a safe persisted summary separate from the detailed exception retained in server logs. */
public class WorkerDispatchException extends RuntimeException {

    private final ProcessingJobError safeError;
    private final boolean retryable;

    public WorkerDispatchException(ProcessingJobError safeError, Throwable cause) {
        this(safeError, cause, true);
    }

    public WorkerDispatchException(ProcessingJobError safeError, Throwable cause, boolean retryable) {
        super("Processing worker dispatch failed", cause);
        this.safeError = safeError;
        this.retryable = retryable;
    }

    public boolean retryable() { return retryable; }

    public ProcessingJobError safeError() {
        return safeError;
    }
}
