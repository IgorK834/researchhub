package dev.researchhub.source.application;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.SourceEntity;
import dev.researchhub.source.infrastructure.SourceRepository;
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

    @Test
    void resolvesOnlyTheSourceScopedByWorkspaceAndCreatesTemporaryAccess() throws Exception {
        SourceRepository repository = mock(SourceRepository.class);
        SourceStorage storage = mock(SourceStorage.class);
        UUID workspaceId = UUID.randomUUID();
        UUID sourceId = UUID.randomUUID();
        Source source = source(sourceId, workspaceId);
        Instant expiry = Instant.parse("2030-01-02T03:04:05Z");
        URI uri = URI.create("https://storage.example/source?sp=r&sig=temporary");
        when(repository.findByWorkspaceIdAndId(workspaceId, sourceId))
                .thenReturn(Optional.of(SourceEntity.fromDomain(source)));
        when(storage.createTemporaryReadAccess(source.storageKey(), Duration.ofMinutes(5)))
                .thenReturn(Optional.of(new TemporaryReadAccess(uri, expiry)));

        SourceIngestInput input = new SourceIngestInputResolver(repository, storage)
                .resolve(workspaceId, sourceId, Duration.ofMinutes(5));

        assertEquals("PDF", input.sourceType());
        assertEquals(uri, input.signedReadUrl());
        assertEquals(expiry, input.expiresAt());
    }

    @Test
    void crossWorkspaceLookupAndStorageWithoutSignedAccessFailClosed() throws Exception {
        SourceRepository repository = mock(SourceRepository.class);
        SourceStorage storage = mock(SourceStorage.class);
        UUID workspaceId = UUID.randomUUID();
        UUID sourceId = UUID.randomUUID();
        SourceIngestInputResolver resolver = new SourceIngestInputResolver(repository, storage);

        when(repository.findByWorkspaceIdAndId(workspaceId, sourceId)).thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class,
                () -> resolver.resolve(workspaceId, sourceId, Duration.ofMinutes(5)));

        Source source = source(sourceId, workspaceId);
        when(repository.findByWorkspaceIdAndId(workspaceId, sourceId))
                .thenReturn(Optional.of(SourceEntity.fromDomain(source)));
        when(storage.createTemporaryReadAccess(source.storageKey(), Duration.ofMinutes(5)))
                .thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class,
                () -> resolver.resolve(workspaceId, sourceId, Duration.ofMinutes(5)));
    }

    private static Source source(UUID id, UUID workspaceId) {
        Instant now = Instant.parse("2026-09-29T10:00:00Z");
        return new Source(id, workspaceId, new SourceFilename("paper.pdf"), "paper.pdf", SourceType.PDF, 128,
                StorageKey.generate(), "a".repeat(64), SourceStatus.UPLOADED, null, UUID.randomUUID(), now, now);
    }
}
