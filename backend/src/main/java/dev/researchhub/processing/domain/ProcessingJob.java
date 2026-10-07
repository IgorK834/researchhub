package dev.researchhub.processing.domain;

import dev.researchhub.shared.error.ConflictException;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Durable description of one attemptable processing operation. */
public record ProcessingJob(
        UUID id,
        UUID workspaceId,
        ProcessingJobType jobType,
        ProcessingResourceType resourceType,
        UUID resourceId,
        ProcessingJobStatus status,
        int attemptCount,
        Instant createdAt,
        Instant startedAt,
        Instant finishedAt,
        ProcessingJobError lastError,
        Instant nextAttemptAt,
        String requestId
) {

    /** Database guardrail; deployments configure a smaller operational retry limit. */
    public static final int ATTEMPT_COUNT_CEILING = 100;

    public ProcessingJob(UUID id, UUID workspaceId, ProcessingJobType jobType, ProcessingResourceType resourceType,
                         UUID resourceId, ProcessingJobStatus status, int attemptCount, Instant createdAt,
                         Instant startedAt, Instant finishedAt, ProcessingJobError lastError, Instant nextAttemptAt) {
        this(id, workspaceId, jobType, resourceType, resourceId, status, attemptCount, createdAt,
             startedAt, finishedAt, lastError, nextAttemptAt, id.toString());
    }

    public ProcessingJob {
        if (!dev.researchhub.shared.observability.CorrelationContext.valid(requestId))
            throw new IllegalArgumentException("invalid request ID");
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(workspaceId, "workspaceId");
        Objects.requireNonNull(jobType, "jobType");
        Objects.requireNonNull(resourceType, "resourceType");
        Objects.requireNonNull(resourceId, "resourceId");
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(createdAt, "createdAt");
        if (attemptCount < 0 || attemptCount > ATTEMPT_COUNT_CEILING) {
            throw new IllegalArgumentException("attempt count must be between 0 and 100");
        }
        validateState(status, attemptCount, startedAt, finishedAt, lastError, nextAttemptAt);
        if (startedAt != null && startedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("a job cannot start before it was created");
        }
        if (finishedAt != null && finishedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("a job cannot finish before it was created");
        }
        if (nextAttemptAt != null && nextAttemptAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("a job cannot be eligible before it was created");
        }
    }

    public static ProcessingJob pending(UUID workspaceId, ProcessingJobType jobType,
                                        ProcessingResourceType resourceType, UUID resourceId, Instant now) {
        return new ProcessingJob(UUID.randomUUID(), workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.PENDING, 0, now, null, null, null, now);
    }

    public static ProcessingJob pending(UUID workspaceId, ProcessingJobType jobType,
                                        ProcessingResourceType resourceType, UUID resourceId, Instant now, String requestId) {
        return new ProcessingJob(UUID.randomUUID(), workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.PENDING, 0, now, null, null, null, now, requestId);
    }

    public ProcessingJob start(Instant now, int maxAttempts) {
        requireTransition(ProcessingJobStatus.RUNNING);
        if (attemptCount >= maxAttempts) {
            throw new ConflictException("The processing job has exhausted its retry limit");
        }
        return new ProcessingJob(id, workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.RUNNING, attemptCount + 1, createdAt, now, null, null, null, requestId);
    }

    public ProcessingJob succeed(Instant now) {
        requireTransition(ProcessingJobStatus.SUCCEEDED);
        return new ProcessingJob(id, workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.SUCCEEDED, attemptCount, createdAt, startedAt, now, null, null, requestId);
    }

    public ProcessingJob retry(ProcessingJobError error, Instant nextAttempt) {
        requireTransition(ProcessingJobStatus.PENDING);
        return new ProcessingJob(id, workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.PENDING, attemptCount, createdAt, null, null,
                Objects.requireNonNull(error, "error"), nextAttempt, requestId);
    }

    public ProcessingJob fail(ProcessingJobError error, Instant now) {
        requireTransition(ProcessingJobStatus.FAILED);
        return new ProcessingJob(id, workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.FAILED, attemptCount, createdAt, startedAt, now,
                Objects.requireNonNull(error, "error"), null, requestId);
    }

    public ProcessingJob cancel(Instant now) {
        requireTransition(ProcessingJobStatus.CANCELLED);
        return new ProcessingJob(id, workspaceId, jobType, resourceType, resourceId,
                ProcessingJobStatus.CANCELLED, attemptCount, createdAt, startedAt, now, null, null, requestId);
    }

    private void requireTransition(ProcessingJobStatus target) {
        if (!status.canMoveTo(target)) {
            throw new ConflictException("A processing job that is " + status + " cannot become " + target);
        }
    }

    private static void validateState(ProcessingJobStatus status, int attempts, Instant started, Instant finished,
                                      ProcessingJobError error, Instant nextAttempt) {
        switch (status) {
            case PENDING -> {
                require(started == null && finished == null && nextAttempt != null,
                        "a pending job needs only its next attempt time");
                require((attempts == 0 && error == null) || (attempts > 0 && error != null),
                        "a retried pending job needs its safe last error");
            }
            case RUNNING -> require(attempts > 0 && started != null && finished == null
                            && error == null && nextAttempt == null,
                    "a running job needs a start and no terminal metadata");
            case SUCCEEDED -> require(attempts > 0 && started != null && finished != null
                            && error == null && nextAttempt == null,
                    "a succeeded job needs start and finish times");
            case FAILED -> require(attempts > 0 && started != null && finished != null
                            && error != null && nextAttempt == null,
                    "a failed job needs times and a safe error");
            case CANCELLED -> require(finished != null && error == null && nextAttempt == null,
                    "a cancelled job needs a finish time only");
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalArgumentException(message);
        }
    }
}
