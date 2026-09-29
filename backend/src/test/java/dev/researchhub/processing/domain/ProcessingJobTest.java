package dev.researchhub.processing.domain;

import dev.researchhub.shared.error.ConflictException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProcessingJobTest {

    private static final Instant CREATED = Instant.parse("2026-09-29T08:00:00Z");
    private static final ProcessingJobError ERROR = new ProcessingJobError("WORKER_UNAVAILABLE",
            "The processing worker is temporarily unavailable.");

    @Test
    void followsTheValidatedRetryAndSuccessLifecycle() {
        ProcessingJob pending = pending();
        assertEquals(ProcessingJobStatus.PENDING, pending.status());
        assertEquals(0, pending.attemptCount());
        assertEquals(CREATED, pending.nextAttemptAt());

        ProcessingJob first = pending.start(CREATED.plusSeconds(1), 3);
        ProcessingJob retry = first.retry(ERROR, CREATED.plusSeconds(3));
        ProcessingJob second = retry.start(CREATED.plusSeconds(3), 3);
        ProcessingJob succeeded = second.succeed(CREATED.plusSeconds(4));

        assertEquals(2, succeeded.attemptCount());
        assertEquals(ProcessingJobStatus.SUCCEEDED, succeeded.status());
        assertEquals(CREATED.plusSeconds(3), succeeded.startedAt());
        assertEquals(CREATED.plusSeconds(4), succeeded.finishedAt());
        assertNull(succeeded.lastError());
        assertNull(succeeded.nextAttemptAt());
    }

    @Test
    void supportsTerminalFailureAndCancellationFromAllowedStates() {
        ProcessingJob running = pending().start(CREATED.plusSeconds(1), 2);
        ProcessingJob failed = running.fail(ERROR, CREATED.plusSeconds(2));
        ProcessingJob cancelledPending = pending().cancel(CREATED.plusSeconds(1));
        ProcessingJob cancelledRunning = running.cancel(CREATED.plusSeconds(2));

        assertEquals(ProcessingJobStatus.FAILED, failed.status());
        assertEquals(ERROR, failed.lastError());
        assertEquals(ProcessingJobStatus.CANCELLED, cancelledPending.status());
        assertNull(cancelledPending.startedAt());
        assertEquals(ProcessingJobStatus.CANCELLED, cancelledRunning.status());
    }

    @Test
    void refusesInvalidTransitionsAndAnExhaustedStart() {
        ProcessingJob running = pending().start(CREATED.plusSeconds(1), 1);
        ProcessingJob succeeded = running.succeed(CREATED.plusSeconds(2));

        assertThrows(ConflictException.class, () -> running.start(CREATED.plusSeconds(2), 2));
        assertThrows(ConflictException.class, () -> succeeded.retry(ERROR, CREATED.plusSeconds(3)));
        assertThrows(ConflictException.class, () -> running.retry(ERROR, CREATED.plusSeconds(3)).start(
                CREATED.plusSeconds(3), 1));
        assertTrue(ProcessingJobStatus.PENDING.canMoveTo(ProcessingJobStatus.RUNNING));
        assertTrue(ProcessingJobStatus.RUNNING.canMoveTo(ProcessingJobStatus.FAILED));
        assertTrue(ProcessingJobStatus.SUCCEEDED.next().isEmpty());
    }

    @Test
    void constructorProtectsAttemptTimeAndStateInvariants() {
        ProcessingJob pending = pending();
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.PENDING, -1,
                null, null, null, CREATED));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.PENDING, 101,
                null, null, null, CREATED));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.PENDING, 1,
                null, null, null, CREATED));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.RUNNING, 0,
                CREATED, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.SUCCEEDED, 1,
                CREATED, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.FAILED, 1,
                CREATED, CREATED.plusSeconds(1), null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.CANCELLED, 0,
                null, null, null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.RUNNING, 1,
                CREATED.minusSeconds(1), null, null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.CANCELLED, 0,
                null, CREATED.minusSeconds(1), null, null));
        assertThrows(IllegalArgumentException.class, () -> copy(pending, ProcessingJobStatus.PENDING, 0,
                null, null, null, CREATED.minusSeconds(1)));
    }

    private static ProcessingJob pending() {
        return ProcessingJob.pending(UUID.randomUUID(), ProcessingJobType.SOURCE_INGEST,
                ProcessingResourceType.SOURCE, UUID.randomUUID(), CREATED);
    }

    private static ProcessingJob copy(ProcessingJob original, ProcessingJobStatus status, int attemptCount,
                                      Instant startedAt, Instant finishedAt, ProcessingJobError error,
                                      Instant nextAttemptAt) {
        return new ProcessingJob(original.id(), original.workspaceId(), original.jobType(), original.resourceType(),
                original.resourceId(), status, attemptCount, original.createdAt(), startedAt, finishedAt, error,
                nextAttemptAt);
    }
}
