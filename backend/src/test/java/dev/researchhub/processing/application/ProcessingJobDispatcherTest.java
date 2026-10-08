package dev.researchhub.processing.application;

import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.processing.domain.ProcessingJobType;
import dev.researchhub.processing.domain.ProcessingResourceType;
import dev.researchhub.processing.infrastructure.ProcessingProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProcessingJobDispatcherTest {

    private static final Instant NOW = Instant.parse("2026-09-29T09:00:00Z");

    private ProcessingJobQueue queue;
    private ProcessingWorkerClient worker;
    private ProcessingJobStateListener listener;
    private ProcessingProperties properties;
    private ProcessingJobDispatcher dispatcher;
    private io.micrometer.core.instrument.simple.SimpleMeterRegistry metrics;

    @BeforeEach
    void setUp() {
        queue = mock(ProcessingJobQueue.class);
        worker = mock(ProcessingWorkerClient.class);
        listener = mock(ProcessingJobStateListener.class);
        when(listener.supports(any())).thenReturn(true);
        when(queue.updateState(any(), any(), anyInt(), any())).thenReturn(true);
        properties = new ProcessingProperties();
        metrics = new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        dispatcher = new ProcessingJobDispatcher(queue, worker, List.of(listener), properties,
                Clock.fixed(NOW, ZoneOffset.UTC), mock(org.springframework.transaction.PlatformTransactionManager.class),
                new dev.researchhub.shared.observability.WorkMetrics(metrics));
    }

    @Test
    void disablingScheduledDispatchKeepsTheBeanButDoesNotClaimOrCallTheWorker() {
        properties.getDispatcher().setEnabled(false);
        dispatcher.scheduledDispatch();
        org.mockito.Mockito.verifyNoInteractions(queue, worker);
    }

    @Test
    void successfulDeliveryCompletesTheDurableJobAndNotifiesItsOwner() {
        ProcessingJob running = running(1);
        ProcessingJobNotification notification = ProcessingJobNotification.from(running);

        dispatcher.dispatch(running);

        verify(listener).running(notification);
        verify(worker).execute(running);
        ArgumentCaptor<ProcessingJob> updated = ArgumentCaptor.forClass(ProcessingJob.class);
        verify(queue).updateState(eq(running.id()), eq(ProcessingJobStatus.RUNNING), eq(1), updated.capture());
        assertEquals(ProcessingJobStatus.SUCCEEDED, updated.getValue().status());
        assertEquals(NOW, updated.getValue().finishedAt());
        verify(listener).succeeded(ProcessingJobNotification.from(updated.getValue()));
        verify(listener, never()).failed(any(), any());
    }

    @Test
    void unavailableWorkerSchedulesARefreshableBoundedRetryWithASafeError() {
        ProcessingJob running = running(1);
        ProcessingJobError safe = new ProcessingJobError("WORKER_UNAVAILABLE",
                "The processing worker is temporarily unavailable.");
        doThrow(new WorkerDispatchException(safe, new IllegalStateException("private network detail")))
                .when(worker).execute(running);

        dispatcher.dispatch(running);

        ArgumentCaptor<ProcessingJob> updated = ArgumentCaptor.forClass(ProcessingJob.class);
        verify(queue).updateState(eq(running.id()), eq(ProcessingJobStatus.RUNNING), eq(1), updated.capture());
        assertEquals(ProcessingJobStatus.PENDING, updated.getValue().status());
        assertEquals(safe, updated.getValue().lastError());
        assertEquals(NOW.plusSeconds(2), updated.getValue().nextAttemptAt());
        assertEquals(running.requestId(),updated.getValue().requestId());
        assertEquals(1,metrics.get("researchhub.worker.failures").counter().count());
        assertEquals(1,metrics.get("researchhub.worker.retries").counter().count());
        assertEquals(1,metrics.get("researchhub.source.processing.duration").tag("outcome","failure").timer().count());
        verify(listener, never()).failed(any(), any());
    }

    @Test
    void lastAttemptBecomesFailedAndUnexpectedDetailsAreNotPersisted() {
        properties.getDispatcher().setMaxAttempts(3);
        ProcessingJob running = running(3);
        doThrow(new IllegalStateException("database password=private"))
                .when(worker).execute(running);

        dispatcher.dispatch(running);

        ArgumentCaptor<ProcessingJob> updated = ArgumentCaptor.forClass(ProcessingJob.class);
        verify(queue).updateState(eq(running.id()), eq(ProcessingJobStatus.RUNNING), eq(3), updated.capture());
        ProcessingJob failed = updated.getValue();
        assertEquals(ProcessingJobStatus.FAILED, failed.status());
        assertEquals("WORKER_ERROR", failed.lastError().code());
        assertEquals("The processing worker could not complete the job.", failed.lastError().message());
        assertEquals(1,metrics.get("researchhub.worker.failures").counter().count());
        org.junit.jupiter.api.Assertions.assertNull(metrics.find("researchhub.worker.retries").counter());
        verify(listener).failed(ProcessingJobNotification.from(failed), ProcessingFailure.from(failed.lastError()));
    }

    @Test
    void oneTickRecoversStaleJobsAndClaimsOnlyTheConfiguredBatch() {
        properties.getDispatcher().setBatchSize(1);
        ProcessingJob stale = running(3).fail(new ProcessingJobError("WORKER_TIMEOUT",
                "The processing worker did not finish before the timeout."), NOW);
        ProcessingJob claimed = running(1);
        when(queue.recoverStale(any(), eq(NOW), eq(5)))
                .thenReturn(new StaleJobRecovery(List.of(), List.of(stale)));
        when(queue.claimNext(eq(NOW), eq(5))).thenReturn(Optional.of(claimed));

        dispatcher.scheduledDispatch();

        verify(listener).failed(ProcessingJobNotification.from(stale), ProcessingFailure.from(stale.lastError()));
        verify(worker).execute(claimed);
        verify(queue, times(1)).claimNext(NOW, 5);
    }

    @Test
    void exponentialBackoffSaturatesAtTheConfiguredMaximum() {
        ProcessingProperties.Dispatcher policy = properties.getDispatcher();
        policy.setInitialBackoff(Duration.ofSeconds(3));
        policy.setMaxBackoff(Duration.ofSeconds(10));

        assertEquals(Duration.ofSeconds(3), ProcessingJobDispatcher.backoff(1, policy));
        assertEquals(Duration.ofSeconds(6), ProcessingJobDispatcher.backoff(2, policy));
        assertEquals(Duration.ofSeconds(10), ProcessingJobDispatcher.backoff(3, policy));
        assertEquals(Duration.ofSeconds(10), ProcessingJobDispatcher.backoff(20, policy));
    }

    @Test
    void obsoleteCompletionDoesNotPublishSuccessOrFailure() {
        when(queue.updateState(any(), any(), anyInt(), any())).thenReturn(false);
        dispatcher.dispatch(running(1));
        verify(listener, never()).succeeded(any());
        properties.getDispatcher().setMaxAttempts(3);
        var last = running(3);
        doThrow(new IllegalStateException("late response")).when(worker).execute(last);
        dispatcher.dispatch(last);
        verify(listener, never()).failed(any(), any());
    }

    @Test
    void malformedDocumentFailureIsTerminalOnItsFirstAttempt() {
        var job = running(1);
        var failure = new ProcessingJobError("DOCUMENT_PARSE_FAILED", "The document could not be read.");
        doThrow(new WorkerDispatchException(failure, null, false)).when(worker).execute(job);
        dispatcher.dispatch(job);
        var changed = ArgumentCaptor.forClass(ProcessingJob.class);
        verify(queue).updateState(eq(job.id()), eq(ProcessingJobStatus.RUNNING), eq(1), changed.capture());
        assertEquals(ProcessingJobStatus.FAILED, changed.getValue().status());
        verify(listener).failed(ProcessingJobNotification.from(changed.getValue()), ProcessingFailure.from(failure));
    }

    private static ProcessingJob running(int attempt) {
        return new ProcessingJob(UUID.randomUUID(), UUID.randomUUID(), ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, UUID.randomUUID(), ProcessingJobStatus.RUNNING, attempt,
                NOW.minusSeconds(30), NOW.minusSeconds(1), null, null, null);
    }
}
