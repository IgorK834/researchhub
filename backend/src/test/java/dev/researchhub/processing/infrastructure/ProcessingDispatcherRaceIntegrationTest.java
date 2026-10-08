package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.*;
import dev.researchhub.processing.domain.*;
import dev.researchhub.support.DispatcherRaceDatabase;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class ProcessingDispatcherRaceIntegrationTest extends DispatcherRaceDatabase {
    private final ProcessingProperties policy = new ProcessingProperties();
    protected void registerDispatcher(AnnotationConfigApplicationContext context) {
        context.registerBean(PostgresProcessingJobQueue.class);
        context.registerBean(ProcessingJobDispatcher.class, () -> new ProcessingJobDispatcher(
                context.getBean(PostgresProcessingJobQueue.class), job -> record(job.id()), List.of(), policy, clock,
                context.getBean(PlatformTransactionManager.class)));
    }
    private ProcessingJob seed() {
        var job = ProcessingJob.pending(workspace, ProcessingJobType.SOURCE_INGEST, ProcessingResourceType.SOURCE, UUID.randomUUID(), clock.instant());
        return contexts.getFirst().getBean(PostgresProcessingJobQueue.class).insertIfAbsent(job);
    }
    @RepeatedTest(20) void threeDispatchersExecuteTwoHundredJobsExactlyOnce() throws Exception {
        var expected = new HashSet<UUID>();
        for (int i = 0; i < 200; i++) expected.add(seed().id());
        race(context -> context.getBean(ProcessingJobDispatcher.class).dispatchAvailable());
        assertExactlyOnce(expected, "processing_jobs");
        assertEquals(200, jdbc.queryForObject("SELECT count(*) FROM processing_jobs WHERE attempt_count=1", Integer.class));
    }
    @Test void killedContextIsRecoveredAfterLeaseAndRetriesRespectExponentialBackoff() throws Exception {
        var job = seed(); var claimed = new CountDownLatch(1);
        var settings = new ProcessingProperties(); settings.getDispatcher().setBatchSize(1);
        settings.getDispatcher().setMaxAttempts(4); settings.getDispatcher().setStaleTimeout(Duration.ofSeconds(10));
        settings.getDispatcher().setMaxBackoff(Duration.ofSeconds(4));
        var dead = contexts.getFirst();
        var queue = dead.getBean(PostgresProcessingJobQueue.class);
        ProcessingJobStateListener hold = new ProcessingJobStateListener() {
            public boolean supports(ProcessingJobNotification n) { return true; }
            public void running(ProcessingJobNotification n) {
                claimed.countDown();
                try { new CountDownLatch(1).await(); }
                catch (InterruptedException killed) { Thread.currentThread().interrupt(); throw new DispatcherKilled(); }
            }
            public void succeeded(ProcessingJobNotification n) {}
            public void failed(ProcessingJobNotification n, ProcessingFailure error) {}
        };
        var doomed = new ProcessingJobDispatcher(queue, j -> fail("Killed dispatcher must not call the worker"), List.of(hold), settings, clock, dead.getBean(PlatformTransactionManager.class));
        ProcessingJob stale;
        try (var executor = Executors.newSingleThreadExecutor()) {
            var task = executor.submit(doomed::dispatchAvailable);
            assertTrue(claimed.await(10, TimeUnit.SECONDS)); stale = queue.find(job.id()).orElseThrow();
            task.cancel(true); executor.shutdownNow(); assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS));
        }
        dead.close();
        var survivor = contexts.get(1); var survivingQueue = survivor.getBean(PostgresProcessingJobQueue.class);
        var attempts = new ArrayList<Integer>();
        var dispatcher = new ProcessingJobDispatcher(survivingQueue, j -> {
            attempts.add(j.attemptCount());
            if (j.attemptCount() < 4) throw new WorkerDispatchException(new ProcessingJobError("WORKER_UNAVAILABLE", "Temporary outage"), new RuntimeException());
            record(j.id());
        }, List.of(), settings, clock, survivor.getBean(PlatformTransactionManager.class));
        clock.now = clock.now.plusSeconds(9); dispatcher.dispatchAvailable(); assertTrue(attempts.isEmpty());
        clock.now = clock.now.plusSeconds(1); dispatcher.dispatchAvailable();
        assertEquals(List.of(2), attempts);
        var retry = survivingQueue.find(job.id()).orElseThrow();
        assertEquals(clock.now.plusSeconds(4), retry.nextAttemptAt());
        assertFalse(survivingQueue.updateState(job.id(), ProcessingJobStatus.RUNNING, stale.attemptCount(), stale.succeed(clock.now)));
        clock.now = clock.now.plusSeconds(3); dispatcher.dispatchAvailable(); assertEquals(List.of(2), attempts);
        clock.now = clock.now.plusSeconds(1); dispatcher.dispatchAvailable(); assertEquals(List.of(2, 3), attempts);
        assertEquals(clock.now.plusSeconds(4), survivingQueue.find(job.id()).orElseThrow().nextAttemptAt());
        clock.now = clock.now.plusSeconds(4); dispatcher.dispatchAvailable(); dispatcher.dispatchAvailable();
        assertEquals(List.of(2, 3, 4), attempts); assertEquals(Map.of(job.id(), 1), calls);
        assertEquals(ProcessingJobStatus.SUCCEEDED, survivingQueue.find(job.id()).orElseThrow().status());
        // Restore the independently restarted context for subsequent repeated tests.
        contexts.set(0, newContext());
    }
    private static class DispatcherKilled extends Error {}
}
