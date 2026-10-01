package dev.researchhub.source.application;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.SourceVersion;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.SourceVersionEntity;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SourceIngestInputResolverTest {

    private final SourceVersionRepository versions = mock(SourceVersionRepository.class);
    private final SourceVersionJobRepository jobs = mock(SourceVersionJobRepository.class);
    private final SourceStorage storage = mock(SourceStorage.class);
    private final UUID workspaceId = UUID.randomUUID();
    private final UUID sourceId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final SourceIngestInputResolver resolver = new SourceIngestInputResolver(versions, jobs, storage);

    @Test
    void resolvesTheVersionBoundToTheJobAndCreatesTemporaryAccess() throws Exception {
        SourceVersion version = version(UUID.randomUUID());
        Instant expiry = Instant.parse("2030-01-02T03:04:05Z");
        URI uri = URI.create("https://storage.example/source?sp=r&sig=temporary");
        when(jobs.findVersionId(jobId)).thenReturn(Optional.of(version.id()));
        when(versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, version.id()))
                .thenReturn(Optional.of(SourceVersionEntity.fromDomain(version)));
        when(storage.createTemporaryReadAccess(version.storageKey(), Duration.ofMinutes(5)))
                .thenReturn(Optional.of(new TemporaryReadAccess(uri, expiry)));

        SourceIngestInput input = resolver.resolve(workspaceId, sourceId, jobId, Duration.ofMinutes(5));

        assertEquals("PDF", input.sourceType());
        assertEquals(uri, input.signedReadUrl());
        assertEquals(expiry, input.expiresAt());
    }

    @Test
    void aRetryReadsTheBytesCapturedWhenTheJobWasEnqueuedNotTheLatestUpload() throws Exception {
        SourceVersion original = version(UUID.randomUUID());
        SourceVersion latest = version(UUID.randomUUID());
        when(jobs.findVersionId(jobId)).thenReturn(Optional.of(original.id()));
        when(versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, original.id()))
                .thenReturn(Optional.of(SourceVersionEntity.fromDomain(original)));
        when(storage.createTemporaryReadAccess(original.storageKey(), Duration.ofMinutes(5)))
                .thenReturn(Optional.of(new TemporaryReadAccess(URI.create("https://storage.example/original"),
                        Instant.parse("2030-01-02T03:04:05Z"))));

        resolver.resolve(workspaceId, sourceId, jobId, Duration.ofMinutes(5));

        org.mockito.Mockito.verify(storage).createTemporaryReadAccess(original.storageKey(), Duration.ofMinutes(5));
        org.mockito.Mockito.verify(storage, org.mockito.Mockito.never())
                .createTemporaryReadAccess(latest.storageKey(), Duration.ofMinutes(5));
    }

    @Test
    void anUnboundJobCrossWorkspaceLookupAndStorageWithoutSignedAccessFailClosed() throws Exception {
        when(jobs.findVersionId(jobId)).thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class,
                () -> resolver.resolve(workspaceId, sourceId, jobId, Duration.ofMinutes(5)));

        SourceVersion version = version(UUID.randomUUID());
        when(jobs.findVersionId(jobId)).thenReturn(Optional.of(version.id()));
        when(versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, version.id()))
                .thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class,
                () -> resolver.resolve(workspaceId, sourceId, jobId, Duration.ofMinutes(5)));

        when(versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, version.id()))
                .thenReturn(Optional.of(SourceVersionEntity.fromDomain(version)));
        when(storage.createTemporaryReadAccess(version.storageKey(), Duration.ofMinutes(5)))
                .thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class,
                () -> resolver.resolve(workspaceId, sourceId, jobId, Duration.ofMinutes(5)));
    }

    private SourceVersion version(UUID id) {
        Instant now = Instant.parse("2026-09-29T10:00:00Z");
        return new SourceVersion(id, sourceId, workspaceId, 1, new SourceFilename("paper.pdf"), SourceType.PDF, 128,
                StorageKey.generate(), "a".repeat(64), SourceStatus.UPLOADED, null, UUID.randomUUID(), now, now);
    }
}
