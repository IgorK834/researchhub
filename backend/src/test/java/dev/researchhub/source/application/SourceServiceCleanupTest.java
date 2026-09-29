package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingJobService;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.io.ByteArrayInputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The one clean-up path a real database will not produce on demand: the bytes were stored, and then the row could
 * not be written. The stored object must not be left behind.
 */
class SourceServiceCleanupTest {

    @Test
    void aFailedInsertRemovesTheStoredBytes() {
        SourceRepository repository = mock(SourceRepository.class);
        when(repository.saveAndFlush(any(SourceEntity.class)))
                .thenThrow(new DataIntegrityViolationException("simulated"));
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        InMemorySourceStorage storage = new InMemorySourceStorage();

        SourceService service = new SourceService(repository, storage, new SourceLimits(1024),
                new UnlimitedWorkspaceSourceQuota(), mock(WorkspaceAuthorizationService.class),
                mock(ProcessingJobService.class), transactions,
                Clock.fixed(Instant.parse("2026-09-24T10:00:00Z"), ZoneOffset.UTC));

        assertThrows(DataIntegrityViolationException.class, () -> service.upload(UUID.randomUUID(),
                UUID.randomUUID(), new UploadSourceCommand("notes.txt", "text/plain", null,
                        new ByteArrayInputStream("hello".getBytes()))));

        assertEquals(0, storage.objectCount());
    }

}
