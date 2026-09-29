package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.processing.infrastructure.ProcessingProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/** Claims committed jobs and drives retryable worker delivery outside the end-user HTTP request. */
@Component
@Profile("local")
@ConditionalOnProperty(prefix = "researchhub.processing.dispatcher", name = "enabled",
        havingValue = "true", matchIfMissing = true)
public class ProcessingJobDispatcher {

    private static final Logger log = LoggerFactory.getLogger(ProcessingJobDispatcher.class);
    private static final ProcessingJobError UNEXPECTED = new ProcessingJobError("WORKER_ERROR",
            "The processing worker could not complete the job.");

    private final ProcessingJobQueue queue;
    private final ProcessingWorkerClient worker;
    private final List<ProcessingJobStateListener> listeners;
    private final ProcessingProperties properties;
    private final Clock clock;

    public ProcessingJobDispatcher(ProcessingJobQueue queue, ProcessingWorkerClient worker,
                                   List<ProcessingJobStateListener> listeners, ProcessingProperties properties,
                                   Clock clock) {
        this.queue = queue;
        this.worker = worker;
        this.listeners = List.copyOf(listeners);
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${researchhub.processing.dispatcher.fixed-delay:PT1S}")
    public void dispatchAvailable() {
        Instant now = clock.instant();
        ProcessingProperties.Dispatcher policy = properties.getDispatcher();
        StaleJobRecovery recovery = queue.recoverStale(now.minus(policy.getStaleTimeout()), now,
                policy.getMaxAttempts());
        recovery.failed().forEach(job -> notifyFailed(job, job.lastError()));
        if (!recovery.requeued().isEmpty() || !recovery.failed().isEmpty()) {
            log.warn("event=processing.stale_recovered requeued={} failed={}",
                    recovery.requeued().size(), recovery.failed().size());
        }

        for (int index = 0; index < policy.getBatchSize(); index++) {
            ProcessingJob job = queue.claimNext(clock.instant(), policy.getMaxAttempts()).orElse(null);
            if (job == null) {
                return;
            }
            dispatch(job);
        }
    }

    void dispatch(ProcessingJob job) {
        ProcessingJobNotification notification = ProcessingJobNotification.from(job);
        try {
            listenersFor(notification).forEach(listener -> listener.running(notification));
            worker.execute(job);
            ProcessingJob succeeded = job.succeed(clock.instant());
            ProcessingJobNotification succeededNotification = ProcessingJobNotification.from(succeeded);
            listenersFor(succeededNotification).forEach(listener -> listener.succeeded(succeededNotification));
            if (queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), succeeded)) {
                log.info("event=processing.succeeded jobId={} jobType={} resourceType={} resourceId={} attempt={}",
                        job.id(), job.jobType(), job.resourceType(), job.resourceId(), job.attemptCount());
            }
        } catch (RuntimeException failure) {
            ProcessingJobError safe = failure instanceof WorkerDispatchException dispatchFailure
                    ? dispatchFailure.safeError() : UNEXPECTED;
            log.error("event=processing.attempt_failed jobId={} jobType={} resourceType={} resourceId={} attempt={}",
                    job.id(), job.jobType(), job.resourceType(), job.resourceId(), job.attemptCount(), failure);
            recordFailure(job, safe);
        }
    }

    private void recordFailure(ProcessingJob job, ProcessingJobError error) {
        ProcessingProperties.Dispatcher policy = properties.getDispatcher();
        if (job.attemptCount() >= policy.getMaxAttempts()) {
            ProcessingJob failed = job.fail(error, clock.instant());
            notifyFailed(failed, error);
            queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), failed);
            return;
        }
        Instant retryAt = clock.instant().plus(backoff(job.attemptCount(), policy));
        ProcessingJob pending = job.retry(error, retryAt);
        queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), pending);
    }

    private List<ProcessingJobStateListener> listenersFor(ProcessingJobNotification job) {
        return listeners.stream().filter(listener -> listener.supports(job)).toList();
    }

    private void notifyFailed(ProcessingJob job, ProcessingJobError error) {
        ProcessingJobNotification notification = ProcessingJobNotification.from(job);
        ProcessingFailure failure = ProcessingFailure.from(error);
        listenersFor(notification).forEach(listener -> listener.failed(notification, failure));
    }

    static Duration backoff(int attempt, ProcessingProperties.Dispatcher policy) {
        Duration delay = policy.getInitialBackoff();
        for (int index = 1; index < attempt && delay.compareTo(policy.getMaxBackoff()) < 0; index++) {
            Duration remaining = policy.getMaxBackoff().minus(delay);
            delay = remaining.compareTo(delay) < 0 ? policy.getMaxBackoff() : delay.plus(delay);
        }
        return delay.compareTo(policy.getMaxBackoff()) > 0 ? policy.getMaxBackoff() : delay;
    }
}
