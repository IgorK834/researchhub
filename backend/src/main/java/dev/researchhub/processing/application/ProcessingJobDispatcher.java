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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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

    private final dev.researchhub.shared.observability.WorkMetrics metrics;
    private final ProcessingJobQueue queue;
    private final ProcessingWorkerClient worker;
    private final List<ProcessingJobStateListener> listeners;
    private final ProcessingProperties properties;
    private final Clock clock;
    private final TransactionTemplate transactions;

    public ProcessingJobDispatcher(ProcessingJobQueue queue, ProcessingWorkerClient worker,
                                   List<ProcessingJobStateListener> listeners, ProcessingProperties properties,
                                   Clock clock, PlatformTransactionManager transactionManager) {
        this(queue, worker, listeners, properties, clock, transactionManager,
            new dev.researchhub.shared.observability.WorkMetrics(io.micrometer.core.instrument.Metrics.globalRegistry));
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ProcessingJobDispatcher(ProcessingJobQueue queue, ProcessingWorkerClient worker,
                                   List<ProcessingJobStateListener> listeners, ProcessingProperties properties,
                                   Clock clock, PlatformTransactionManager transactionManager,
                                   dev.researchhub.shared.observability.WorkMetrics metrics) {
        this.metrics = metrics;
        this.transactions = new TransactionTemplate(transactionManager);
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
        recovery.failed().forEach(job -> {
            recovered(job, false);
            notifyFailed(job, job.lastError());
        });
        recovery.requeued().forEach(job -> recovered(job, true));
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

    private void recovered(ProcessingJob job, boolean retry) {
        try (var ignored = dev.researchhub.shared.observability.CorrelationContext.open(job.requestId(),
                java.util.Map.of("jobId", job.id().toString(), "sourceId", job.resourceId().toString()))) {
            metrics.failure(dev.researchhub.shared.observability.WorkMetrics.Queue.SOURCE_INGEST);
            if (retry) metrics.retry(dev.researchhub.shared.observability.WorkMetrics.Queue.SOURCE_INGEST,
                dev.researchhub.shared.observability.WorkMetrics.RetryReason.STALE);
            log.atWarn().addKeyValue("event", "processing.stale_recovered").addKeyValue("retry", retry)
                .log("Stale processing attempt recovered");
        }
    }

    void dispatch(ProcessingJob job) {
        try (var ignored = dev.researchhub.shared.observability.CorrelationContext.open(job.requestId(),
                java.util.Map.of("jobId", job.id().toString(), "sourceId", job.resourceId().toString()))) {
            var sample = metrics.start();
            boolean success = false;
            try { success = dispatchObserved(job); }
            finally { metrics.finish(sample, dev.researchhub.shared.observability.WorkMetrics.Operation.SOURCE, success); }
        }
    }

    private boolean dispatchObserved(ProcessingJob job) {
        ProcessingJobNotification notification = ProcessingJobNotification.from(job);
        try {
            log.atInfo().addKeyValue("event", "processing.started").addKeyValue("attempt", job.attemptCount())
                .log("Source ingestion started");
            listenersFor(notification).forEach(listener -> listener.running(notification));
            worker.execute(job);
            ProcessingJob succeeded = job.succeed(clock.instant());
            ProcessingJobNotification succeededNotification = ProcessingJobNotification.from(succeeded);
            boolean completed = Boolean.TRUE.equals(transactions.execute(_status -> {
                if (!queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), succeeded)) return false;
                listenersFor(succeededNotification).forEach(listener -> listener.succeeded(succeededNotification));
                return true;
            }));
            if (completed) {
                log.atInfo().addKeyValue("event", "processing.succeeded").addKeyValue("attempt", job.attemptCount())
                    .addKeyValue("jobType", job.jobType()).log("Source ingestion succeeded");
            }
            return completed;
        } catch (RuntimeException failure) {
            ProcessingJobError safe = failure instanceof WorkerDispatchException dispatchFailure
                    ? dispatchFailure.safeError() : UNEXPECTED;
            metrics.failure(dev.researchhub.shared.observability.WorkMetrics.Queue.SOURCE_INGEST);
            log.atError().addKeyValue("event", "processing.attempt_failed").addKeyValue("errorCode", safe.code())
                .addKeyValue("errorType", failure.getClass().getSimpleName()).addKeyValue("attempt", job.attemptCount())
                .log("Source ingestion attempt failed");
            recordFailure(job, safe, !(failure instanceof WorkerDispatchException dispatchFailure) || dispatchFailure.retryable());
            return false;
        }
    }

    private void recordFailure(ProcessingJob job, ProcessingJobError error, boolean retryable) {
        ProcessingProperties.Dispatcher policy = properties.getDispatcher();
        if (!retryable || job.attemptCount() >= policy.getMaxAttempts()) {
            ProcessingJob failed = job.fail(error, clock.instant());
            transactions.executeWithoutResult(_status -> {
                if (queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), failed)) {
                    notifyFailed(failed, error);
                }
            });
            return;
        }
        Instant retryAt = clock.instant().plus(backoff(job.attemptCount(), policy));
        ProcessingJob pending = job.retry(error, retryAt);
        if (queue.updateState(job.id(), ProcessingJobStatus.RUNNING, job.attemptCount(), pending)) {
            metrics.retry(dev.researchhub.shared.observability.WorkMetrics.Queue.SOURCE_INGEST,
                dev.researchhub.shared.observability.WorkMetrics.RetryReason.FAILURE);
            log.atWarn().addKeyValue("event", "processing.retry_scheduled").addKeyValue("attempt", job.attemptCount())
                .log("Source ingestion retry scheduled");
        }
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
