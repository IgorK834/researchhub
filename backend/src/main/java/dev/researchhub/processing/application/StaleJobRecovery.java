package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;

import java.util.List;

/** Jobs recovered from an expired RUNNING lease during one dispatcher tick. */
public record StaleJobRecovery(List<ProcessingJob> requeued, List<ProcessingJob> failed) {
    public StaleJobRecovery {
        requeued = List.copyOf(requeued);
        failed = List.copyOf(failed);
    }
}
