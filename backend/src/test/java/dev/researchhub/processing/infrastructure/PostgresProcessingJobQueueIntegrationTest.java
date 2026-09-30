package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.ProcessingJobQueue;
import dev.researchhub.processing.application.ProcessingJobDispatcher;
import dev.researchhub.processing.application.ProcessingJobService;
import dev.researchhub.processing.application.StaleJobRecovery;
import dev.researchhub.processing.application.WorkerDispatchException;
import dev.researchhub.processing.domain.ProcessingJobError;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobStatus;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.application.CreateWorkspaceCommand;
import dev.researchhub.workspace.application.WorkspaceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
@TestPropertySource(properties = "researchhub.processing.dispatcher.enabled=false")
class PostgresProcessingJobQueueIntegrationTest {

    @Autowired
    private ProcessingJobQueue queue;

    @Autowired
    private ProcessingJobService jobs;

    @Autowired
    private WorkspaceService workspaces;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private org.springframework.transaction.PlatformTransactionManager transactionManager;

    private UUID workspaceId;

    @BeforeEach
    void createWorkspace() {
        cleanup();
        UUID owner = UserRowFixture.insertUser(jdbc, "processing-owner@example.com", "Processing Owner");
        workspaceId = workspaces.create(new CreateWorkspaceCommand("Processing workspace", null, owner)).id();
    }

    @AfterEach
    void cleanup() {
        jdbc.execute("DELETE FROM processing_jobs");
        UserRowFixture.deleteWorkspaceAndUserRows(jdbc);
    }

    @Test
    void enqueueIsIdempotentAndARowSurvivesAQueueInstanceRestart() {
        UUID sourceId = UUID.randomUUID();
        ProcessingJob first = jobs.enqueueSourceIngest(workspaceId, sourceId);
        ProcessingJob duplicate = jobs.enqueueSourceIngest(workspaceId, sourceId);

        assertEquals(first.id(), duplicate.id());
        assertEquals(1, countJobs());

        ProcessingJobQueue restartedAdapter = new PostgresProcessingJobQueue(jdbc);
        assertEquals(first, restartedAdapter.find(first.id()).orElseThrow());
        assertEquals(first, restartedAdapter.findByResource(first.jobType(), first.resourceType(), sourceId)
                .orElseThrow());
    }

    @Test
    void concurrentDispatchersCannotClaimTheSamePendingJob() throws Exception {
        ProcessingJob pending = jobs.enqueueSourceIngest(workspaceId, UUID.randomUUID());
        Instant claimTime = pending.createdAt().plusSeconds(1);
        CyclicBarrier simultaneousStart = new CyclicBarrier(2);

        List<Optional<ProcessingJob>> claims;
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<Optional<ProcessingJob>> first = executor.submit(() -> {
                simultaneousStart.await();
                return queue.claimNext(claimTime, 5);
            });
            Future<Optional<ProcessingJob>> second = executor.submit(() -> {
                simultaneousStart.await();
                return queue.claimNext(claimTime, 5);
            });
            claims = List.of(first.get(), second.get());
        }

        assertEquals(1, claims.stream().filter(Optional::isPresent).count());
        ProcessingJob claimed = claims.stream().flatMap(Optional::stream).findFirst().orElseThrow();
        assertEquals(pending.id(), claimed.id());
        assertEquals(ProcessingJobStatus.RUNNING, claimed.status());
        assertEquals(1, claimed.attemptCount());
        assertTrue(queue.claimNext(claimTime, 5).isEmpty());
    }

    @Test
    void staleRunningWorkIsRetriedAndEventuallyFailsAtTheBound() {
        ProcessingJob pending = jobs.enqueueSourceIngest(workspaceId, UUID.randomUUID());
        Instant firstStart = pending.createdAt().plusSeconds(1);
        ProcessingJob first = queue.claimNext(firstStart, 2).orElseThrow();

        StaleJobRecovery firstRecovery = queue.recoverStale(firstStart, firstStart.plusSeconds(10), 2);
        assertEquals(List.of(first.id()), firstRecovery.requeued().stream().map(ProcessingJob::id).toList());
        assertTrue(firstRecovery.failed().isEmpty());
        assertEquals("WORKER_TIMEOUT", firstRecovery.requeued().getFirst().lastError().code());

        Instant secondStart = firstStart.plusSeconds(11);
        ProcessingJob second = queue.claimNext(secondStart, 2).orElseThrow();
        assertEquals(2, second.attemptCount());
        StaleJobRecovery secondRecovery = queue.recoverStale(secondStart, secondStart.plusSeconds(10), 2);

        assertTrue(secondRecovery.requeued().isEmpty());
        assertEquals(List.of(second.id()), secondRecovery.failed().stream().map(ProcessingJob::id).toList());
        ProcessingJob failed = queue.find(second.id()).orElseThrow();
        assertEquals(ProcessingJobStatus.FAILED, failed.status());
        assertEquals("WORKER_TIMEOUT", failed.lastError().code());
        assertFalse(queue.updateState(failed.id(), ProcessingJobStatus.RUNNING, 2, failed));
    }

    @Test
    void stoppedWorkerSchedulesARetryWithoutLosingTheDatabaseJob() {
        ProcessingJob pending = jobs.enqueueSourceIngest(workspaceId, UUID.randomUUID());
        Instant dispatchTime = pending.createdAt().plusSeconds(1);
        ProcessingProperties properties = new ProcessingProperties();
        properties.getDispatcher().setBatchSize(1);
        ProcessingJobDispatcher dispatcher = new ProcessingJobDispatcher(queue, job -> {
            throw new WorkerDispatchException(new ProcessingJobError("WORKER_UNAVAILABLE",
                    "The processing worker is temporarily unavailable."),
                    new IOExceptionWithoutSecrets());
        }, List.of(), properties, Clock.fixed(dispatchTime, ZoneOffset.UTC), transactionManager);

        dispatcher.dispatchAvailable();

        ProcessingJob retriable = queue.find(pending.id()).orElseThrow();
        assertEquals(ProcessingJobStatus.PENDING, retriable.status());
        assertEquals(1, retriable.attemptCount());
        assertEquals("WORKER_UNAVAILABLE", retriable.lastError().code());
        assertEquals(dispatchTime.plusSeconds(2), retriable.nextAttemptAt());
        assertEquals(1, countJobs());
    }

    private int countJobs() {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM processing_jobs", Integer.class);
        return count == null ? 0 : count;
    }

    private static final class IOExceptionWithoutSecrets extends RuntimeException {
    }
}
