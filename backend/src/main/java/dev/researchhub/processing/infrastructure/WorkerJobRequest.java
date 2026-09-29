package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.domain.ProcessingJob;

import java.util.UUID;

/** Explicit internal contract. It deliberately has no user token, cookie, blob key, or file contents. */
public record WorkerJobRequest(
        UUID jobId,
        UUID workspaceId,
        String jobType,
        String resourceType,
        UUID resourceId,
        int attempt
) {
    static WorkerJobRequest from(ProcessingJob job) {
        return new WorkerJobRequest(job.id(), job.workspaceId(), job.jobType().name(), job.resourceType().name(),
                job.resourceId(), job.attemptCount());
    }
}
