package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;

import java.util.Objects;
import java.util.UUID;

/** Stable application-level event exposed to modules that own a processed resource. */
public record ProcessingJobNotification(
        UUID jobId,
        UUID workspaceId,
        String jobType,
        String resourceType,
        UUID resourceId,
        int attemptCount
) {
    public ProcessingJobNotification {
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(workspaceId, "workspaceId");
        Objects.requireNonNull(jobType, "jobType");
        Objects.requireNonNull(resourceType, "resourceType");
        Objects.requireNonNull(resourceId, "resourceId");
        if (attemptCount < 1) {
            throw new IllegalArgumentException("a processing notification needs a positive attempt count");
        }
    }

    public static ProcessingJobNotification from(ProcessingJob job) {
        return new ProcessingJobNotification(job.id(), job.workspaceId(), job.jobType().name(),
                job.resourceType().name(), job.resourceId(), job.attemptCount());
    }
}
