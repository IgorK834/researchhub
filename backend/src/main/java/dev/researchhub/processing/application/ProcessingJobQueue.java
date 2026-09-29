package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Persistence port for durable job creation, claiming, transitions, and stale-lease recovery. */
public interface ProcessingJobQueue {

    ProcessingJob insertIfAbsent(ProcessingJob job);

    Optional<ProcessingJob> find(UUID jobId);

    Optional<ProcessingJob> findByResource(ProcessingJobType jobType, ProcessingResourceType resourceType,
                                           UUID resourceId);

    Optional<ProcessingJob> claimNext(Instant now, int maxAttempts);

    boolean updateState(UUID jobId, ProcessingJobStatus expectedStatus, int expectedAttemptCount,
                        ProcessingJob updated);

    StaleJobRecovery recoverStale(Instant staleBefore, Instant now, int maxAttempts);
}
