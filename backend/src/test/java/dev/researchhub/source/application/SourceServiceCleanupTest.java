package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingJobService;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
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

        SourceService service = new SourceService(repository, mock(SourceVersionRepository.class),
                mock(SourceVersionJobRepository.class), storage, new SourceLimits(1024),
                new UnlimitedWorkspaceSourceQuota(), mock(WorkspaceAuthorizationService.class),
                mock(ProcessingJobService.class), transactions,
                Clock.fixed(Instant.parse("2026-09-24T10:00:00Z"), ZoneOffset.UTC), mock(dev.researchhub.audit.application.ProductAudit.class), new dev.researchhub.security.application.UploadInspector(java.util.List.of()));

        assertThrows(DataIntegrityViolationException.class, () -> service.upload(UUID.randomUUID(),
                UUID.randomUUID(), new UploadSourceCommand("notes.txt", "text/plain", null,
                        new ByteArrayInputStream("hello".getBytes()))));

        assertEquals(0, storage.objectCount());
    }

    @Test
    void invalidOfficeUploadNeverCallsBlobStorageOrCreatesMetadata() {
        SourceRepository repository = mock(SourceRepository.class);
        SourceStorage storage = mock(SourceStorage.class);
        ProcessingJobService jobs = mock(ProcessingJobService.class);
        SourceService service = new SourceService(repository, mock(SourceVersionRepository.class),
                mock(SourceVersionJobRepository.class), storage, new SourceLimits(1024),
                new UnlimitedWorkspaceSourceQuota(), mock(WorkspaceAuthorizationService.class), jobs,
                mock(PlatformTransactionManager.class), Clock.systemUTC(),
                mock(dev.researchhub.audit.application.ProductAudit.class),
                new dev.researchhub.security.application.UploadInspector(java.util.List.of()));
        assertThrows(dev.researchhub.shared.error.UnsupportedFileTypeException.class, () -> service.upload(UUID.randomUUID(),
                UUID.randomUUID(), new UploadSourceCommand("disguised.docx", "application/octet-stream", null,
                        new ByteArrayInputStream(new byte[]{'P','K',3,4,1,2}))));
        org.mockito.Mockito.verifyNoInteractions(storage, repository, jobs);
    }

}
