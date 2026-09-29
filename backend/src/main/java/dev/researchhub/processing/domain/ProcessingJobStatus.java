package dev.researchhub.processing.domain;

import java.util.Set;

/** Durable processing lifecycle. Every application transition is checked against this graph. */
public enum ProcessingJobStatus {
    PENDING,
    RUNNING,
    SUCCEEDED,
    FAILED,
    CANCELLED;

    public Set<ProcessingJobStatus> next() {
        return switch (this) {
            case PENDING -> Set.of(RUNNING, CANCELLED);
            case RUNNING -> Set.of(PENDING, SUCCEEDED, FAILED, CANCELLED);
            case SUCCEEDED, FAILED, CANCELLED -> Set.of();
        };
    }

    public boolean canMoveTo(ProcessingJobStatus target) {
        return next().contains(target);
    }
}
