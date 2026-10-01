package dev.researchhub.source.domain;

import dev.researchhub.shared.error.ConflictException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** RH-130: one uploaded, immutable byte sequence of a stable source. */
class SourceVersionTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final Instant LATER = Instant.parse("2026-09-24T10:05:00Z");
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID SOURCE = UUID.randomUUID();
    private static final UUID UPLOADER = UUID.randomUUID();
    private static final String SHA = "c".repeat(64);

    private static SourceVersion version(SourceStatus status, String failure, int number, long size, String sha) {
        return new SourceVersion(UUID.randomUUID(), SOURCE, WORKSPACE, number, SourceFilename.of("data.csv"),
                SourceType.CSV, size, StorageKey.generate(), sha, status, failure, UPLOADER, NOW, NOW);
    }

    private static SourceVersion uploaded() {
        return version(SourceStatus.UPLOADED, null, 1, 10, SHA);
    }

    @Test
    void projectsTheActiveSourceWithoutChangingAnyInputField() {
        Source source = Source.uploaded(WORKSPACE, SourceFilename.of("data.csv"), SourceType.CSV, 10,
                StorageKey.generate(), SHA, UPLOADER, NOW);
        Source persisted = new Source(SOURCE, source.workspaceId(), source.originalFilename(), source.displayName(),
                source.sourceType(), source.sizeBytes(), source.storageKey(), source.contentSha256(), source.status(),
                null, source.uploadedBy(), source.createdAt(), source.updatedAt(), source.activeVersionId(), 1);

        SourceVersion version = SourceVersion.fromActiveSource(persisted);

        assertEquals(persisted.activeVersionId(), version.id());
        assertEquals(SOURCE, version.sourceId());
        assertEquals(1, version.versionNumber());
        assertEquals(persisted.storageKey(), version.storageKey());
        assertEquals(persisted.contentSha256(), version.contentSha256());
        assertEquals("text/csv", version.mediaType());
        assertEquals(SourceStatus.UPLOADED, version.status());
    }

    @Test
    void aSourceThatIsNotYetPersistedHasNoVersionIdentity() {
        Source unsaved = Source.uploaded(WORKSPACE, SourceFilename.of("data.csv"), SourceType.CSV, 10,
                StorageKey.generate(), SHA, UPLOADER, NOW);
        assertNull(unsaved.id(), "Hibernate assigns the source id on insert");
        assertThrows(IllegalArgumentException.class, () -> SourceVersion.fromActiveSource(unsaved));
    }

    @Test
    void refusesAnInvalidVersionNumberSizeOrHash() {
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.UPLOADED, null, 0, 10, SHA));
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.UPLOADED, null, 1, 0, SHA));
        assertThrows(IllegalArgumentException.class,
                () -> version(SourceStatus.UPLOADED, null, 1, Source.MAX_SIZE_BYTES_CEILING + 1, SHA));
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.UPLOADED, null, 1, 10, "A".repeat(64)));
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.UPLOADED, null, 1, 10, null));
        assertThrows(NullPointerException.class, () -> new SourceVersion(null, SOURCE, WORKSPACE, 1,
                SourceFilename.of("a.csv"), SourceType.CSV, 1, StorageKey.generate(), SHA, SourceStatus.UPLOADED,
                null, UPLOADER, NOW, NOW));
    }

    @Test
    void aFailureSummaryBelongsToFailedVersionsOnlyAndIsBounded() {
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.FAILED, null, 1, 10, SHA));
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.FAILED, "  ", 1, 10, SHA));
        assertThrows(IllegalArgumentException.class,
                () -> version(SourceStatus.FAILED, "x".repeat(Source.FAILURE_SUMMARY_MAX_LENGTH + 1), 1, 10, SHA));
        assertThrows(IllegalArgumentException.class, () -> version(SourceStatus.READY, "stale", 1, 10, SHA));
        assertEquals("Bad file.", version(SourceStatus.FAILED, "  Bad file. ", 1, 10, SHA).failureSummary());
    }

    @Test
    void followsTheSameLifecycleAsTheSourceThatProjectsIt() {
        SourceVersion processing = uploaded().moveTo(SourceStatus.PROCESSING, LATER);
        SourceVersion ready = processing.moveTo(SourceStatus.READY, LATER);

        assertEquals(SourceStatus.READY, ready.status());
        assertEquals(LATER, ready.updatedAt());
        assertEquals(NOW, ready.createdAt());
        assertEquals(uploaded().sizeBytes(), ready.sizeBytes());
        assertThrows(ConflictException.class, () -> uploaded().moveTo(SourceStatus.READY, LATER));
        assertThrows(IllegalArgumentException.class, () -> processing.moveTo(SourceStatus.FAILED, LATER),
                "a failure always carries a summary");
    }

    @Test
    void reprocessingKeepsTheSameBytesAndOnlyFromATerminalState() {
        SourceVersion ready = uploaded().moveTo(SourceStatus.PROCESSING, LATER).moveTo(SourceStatus.READY, LATER);
        SourceVersion failed = uploaded().moveTo(SourceStatus.PROCESSING, LATER).processingFailed("Broken", LATER);

        for (SourceVersion terminal : java.util.List.of(ready, failed)) {
            SourceVersion again = terminal.reprocess(LATER);
            assertEquals(SourceStatus.PROCESSING, again.status());
            assertNull(again.failureSummary());
            assertEquals(terminal.storageKey(), again.storageKey());
            assertEquals(terminal.contentSha256(), again.contentSha256());
            assertEquals(terminal.id(), again.id());
        }
        assertThrows(ConflictException.class, () -> uploaded().reprocess(LATER));
        assertThrows(ConflictException.class, () -> uploaded().processingFailed("Broken", LATER));
    }
}
