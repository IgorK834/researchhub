package dev.researchhub.source.application;

import dev.researchhub.processing.application.ProcessingFailure;
import dev.researchhub.processing.application.ProcessingJobNotification;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.SourceVersion;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
import dev.researchhub.source.infrastructure.SourceVersionEntity;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SourceIngestJobStateListenerTest {

    private static final Instant CREATED = Instant.parse("2026-09-29T08:00:00Z");
    private static final Instant NOW = Instant.parse("2026-09-29T09:00:00Z");

    private SourceRepository repository;
    private dev.researchhub.source.infrastructure.SourceExtractionRepository extractions;
    private dev.researchhub.processing.application.ProcessingJobQueue queue;
    private dev.researchhub.ai.application.RetrievalStore retrieval;
    private dev.researchhub.ai.application.RetrievalIndex index;
    private SourceVersionRepository versions;
    private SourceVersionJobRepository versionJobs;
    private SourceIngestJobStateListener listener;
    private final UUID versionId = UUID.randomUUID();
    private StorageKey storageKey;
    private UUID workspaceId;
    private UUID sourceId;
    private ProcessingJobNotification job;

    @BeforeEach
    void setUp() {
        repository = mock(SourceRepository.class);
        extractions = mock(dev.researchhub.source.infrastructure.SourceExtractionRepository.class);
        queue = mock(dev.researchhub.processing.application.ProcessingJobQueue.class);
        retrieval = mock(dev.researchhub.ai.application.RetrievalStore.class);
        index = mock(dev.researchhub.ai.application.RetrievalIndex.class);
        versions = mock(SourceVersionRepository.class);
        versionJobs = mock(SourceVersionJobRepository.class);
        listener = new SourceIngestJobStateListener(repository, Clock.fixed(NOW, ZoneOffset.UTC), extractions, queue,
                retrieval, index, versions, versionJobs);
        workspaceId = UUID.randomUUID();
        sourceId = UUID.randomUUID();
        storageKey = StorageKey.generate();
        job = new ProcessingJobNotification(UUID.randomUUID(), workspaceId, "SOURCE_INGEST", "SOURCE", sourceId, 1);
        var running = new dev.researchhub.processing.domain.ProcessingJob(job.jobId(), workspaceId,
                dev.researchhub.processing.domain.ProcessingJobType.SOURCE_INGEST,
                dev.researchhub.processing.domain.ProcessingResourceType.SOURCE, sourceId,
                dev.researchhub.processing.domain.ProcessingJobStatus.RUNNING, 1, CREATED, NOW, null, null, null);
        when(queue.findByResource(any(), any(), any())).thenReturn(Optional.of(running));
        when(versionJobs.findVersionId(job.jobId())).thenReturn(Optional.of(versionId));
        when(extractions.existsForJob(workspaceId, sourceId, job.jobId())).thenReturn(true);
        when(retrieval.existsForJob(workspaceId, sourceId, job.jobId())).thenReturn(true);
        when(index.existsForJob(workspaceId, sourceId, job.jobId())).thenReturn(true);
    }

    @Test
    void mirrorsRunningSucceededAndFailedStatesWithSafeText() {
        givenStates(SourceStatus.UPLOADED, SourceStatus.PROCESSING, SourceStatus.PROCESSING);

        listener.running(job);
        listener.succeeded(job);
        ProcessingFailure error = new ProcessingFailure("EXTRACTION_FAILED", "This file could not be processed.");
        listener.failed(job, error);

        ArgumentCaptor<SourceEntity> saved = ArgumentCaptor.forClass(SourceEntity.class);
        verify(repository, org.mockito.Mockito.times(3)).saveAndFlush(saved.capture());
        assertEquals(SourceStatus.PROCESSING, saved.getAllValues().get(0).toDomain().status());
        assertEquals(SourceStatus.READY, saved.getAllValues().get(1).toDomain().status());
        assertEquals(SourceStatus.FAILED, saved.getAllValues().get(2).toDomain().status());
        assertEquals("This file could not be processed.",
                saved.getAllValues().get(2).toDomain().failureSummary());

        ArgumentCaptor<SourceVersionEntity> savedVersions = ArgumentCaptor.forClass(SourceVersionEntity.class);
        verify(versions, org.mockito.Mockito.times(3)).saveAndFlush(savedVersions.capture());
        assertEquals(SourceStatus.PROCESSING, savedVersions.getAllValues().get(0).toDomain().status());
        assertEquals(SourceStatus.READY, savedVersions.getAllValues().get(1).toDomain().status());
        assertEquals(SourceStatus.FAILED, savedVersions.getAllValues().get(2).toDomain().status());
        assertEquals(versionId, savedVersions.getAllValues().get(2).toDomain().id());
    }

    @Test
    void refusesAJobBoundToAnotherVersionOrToNoVersionBeforeChangingAnyState() {
        givenStates(SourceStatus.PROCESSING);
        when(versionJobs.findVersionId(job.jobId())).thenReturn(Optional.of(UUID.randomUUID()));
        assertThrows(IllegalStateException.class, () -> listener.succeeded(job));

        when(versionJobs.findVersionId(job.jobId())).thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class, () -> listener.running(job));

        when(versionJobs.findVersionId(job.jobId())).thenReturn(Optional.of(versionId));
        when(versions.findForUpdate(workspaceId, sourceId, versionId)).thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class, () -> listener.failed(job,
                new ProcessingFailure("EXTRACTION_FAILED", "This file could not be processed.")));

        verify(repository, never()).saveAndFlush(any());
        verify(versions, never()).saveAndFlush(any());
    }

    @Test
    void ignoresAlreadyTerminalSourceStatesAndRejectsAMissingSource() {
        givenStates(SourceStatus.READY);
        when(repository.findByWorkspaceIdAndIdForUpdate(workspaceId, sourceId))
                .thenReturn(Optional.of(SourceEntity.fromDomain(source(SourceStatus.READY))))
                .thenReturn(Optional.empty());

        listener.running(job);
        verify(repository, never()).saveAndFlush(any());
        assertThrows(IllegalStateException.class, () -> listener.succeeded(job));
    }

    @Test
    void staleTerminalFailureCanRecoverASourceStillMarkedUploaded() {
        givenStates(SourceStatus.UPLOADED);
        ProcessingFailure failure = new ProcessingFailure("WORKER_TIMEOUT",
                "The processing worker did not finish before the timeout.");

        listener.failed(job, failure);

        ArgumentCaptor<SourceEntity> saved = ArgumentCaptor.forClass(SourceEntity.class);
        verify(repository).saveAndFlush(saved.capture());
        assertEquals(SourceStatus.FAILED, saved.getValue().toDomain().status());
        assertEquals(failure.message(), saved.getValue().toDomain().failureSummary());
    }

    @Test
    void supportsOnlyTheSourceIngestContract() {
        assertTrue(listener.supports(job));
        ProcessingJobNotification other = new ProcessingJobNotification(UUID.randomUUID(), workspaceId,
                "SOURCE_INGEST", "DOCUMENT", sourceId, 1);
        assertFalse(listener.supports(other));
    }

    @Test
    void refusesReadyWithoutPersistedResultAndIgnoresOldRunNotifications() {
        givenStates(SourceStatus.PROCESSING);
        when(extractions.existsForJob(workspaceId, sourceId, job.jobId())).thenReturn(false);
        assertThrows(IllegalStateException.class, () -> listener.succeeded(job));
        verify(repository, never()).saveAndFlush(any());
        when(queue.findByResource(any(), any(), any())).thenReturn(Optional.empty());
        listener.running(job); listener.succeeded(job);
        listener.failed(job, new ProcessingFailure("STALE", "Old run."));
        verify(repository, never()).saveAndFlush(any());
    }

    private void givenStates(SourceStatus first, SourceStatus... rest) {
        var sourceStub = when(repository.findByWorkspaceIdAndIdForUpdate(workspaceId, sourceId))
                .thenReturn(Optional.of(SourceEntity.fromDomain(source(first))));
        var versionStub = when(versions.findForUpdate(workspaceId, sourceId, versionId))
                .thenReturn(Optional.of(SourceVersionEntity.fromDomain(version(first))));
        for (SourceStatus status : rest) {
            sourceStub = sourceStub.thenReturn(Optional.of(SourceEntity.fromDomain(source(status))));
            versionStub = versionStub.thenReturn(Optional.of(SourceVersionEntity.fromDomain(version(status))));
        }
    }

    private SourceVersion version(SourceStatus status) {
        return SourceVersion.fromActiveSource(source(status));
    }

    /** The active source projects its version, so both always sit in the same lifecycle state. */
    private Source source(SourceStatus status) {
        Source uploaded = new Source(sourceId, workspaceId, new SourceFilename("paper.pdf"), "paper.pdf",
                SourceType.PDF, 12, storageKey, "a".repeat(64), SourceStatus.UPLOADED, null,
                UUID.randomUUID(), CREATED, CREATED, versionId, 1);
        if (status == SourceStatus.UPLOADED) {
            return uploaded;
        }
        Source processing = uploaded.moveTo(SourceStatus.PROCESSING, CREATED.plusSeconds(1));
        return status == SourceStatus.PROCESSING ? processing : processing.moveTo(SourceStatus.READY, NOW);
    }
}
