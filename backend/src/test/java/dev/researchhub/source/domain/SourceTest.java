package dev.researchhub.source.domain;

import dev.researchhub.shared.error.ConflictException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Source invariants, the status lifecycle, and the storage key, with no database. */
class SourceTest {

    private static final Instant NOW = Instant.parse("2026-09-24T10:00:00Z");
    private static final Instant LATER = Instant.parse("2026-09-24T10:05:00Z");
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID UPLOADER = UUID.randomUUID();
    private static final String SHA = "a".repeat(64);

    private static Source uploaded() {
        return Source.uploaded(WORKSPACE, SourceFilename.of("report.pdf"), SourceType.PDF, 1024,
                StorageKey.generate(), SHA, UPLOADER, NOW);
    }

    private static Source withSize(long size) {
        return new Source(null, WORKSPACE, SourceFilename.of("r.pdf"), "r.pdf", SourceType.PDF, size,
                StorageKey.generate(), SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW, NOW, UUID.randomUUID(), 1);
    }

    @Test
    void aNewSourceIsUploadedAndDisplayedUnderItsFileName() {
        Source source = uploaded();

        assertNull(source.id(), "Hibernate assigns the id on insert");
        assertEquals(SourceStatus.UPLOADED, source.status());
        assertEquals("report.pdf", source.displayName());
        assertEquals("application/pdf", source.mediaType(), "always the type's canonical media type");
        assertEquals(NOW, source.createdAt());
        assertEquals(NOW, source.updatedAt());
    }

    @Test
    void refusesAnEmptyOrOversizedSource() {
        assertThrows(IllegalArgumentException.class, () -> withSize(0));
        assertThrows(IllegalArgumentException.class, () -> withSize(Source.MAX_SIZE_BYTES_CEILING + 1));
        assertEquals(Source.MAX_SIZE_BYTES_CEILING, withSize(Source.MAX_SIZE_BYTES_CEILING).sizeBytes());
        assertEquals(1073741824L, Source.MAX_SIZE_BYTES_CEILING, "mirrors ck_sources_size_bytes");
    }

    @Test
    void requiresALowercaseSha256() {
        StorageKey key = StorageKey.generate();
        SourceFilename name = SourceFilename.of("r.pdf");
        assertThrows(IllegalArgumentException.class, () -> Source.uploaded(WORKSPACE, name, SourceType.PDF, 1, key,
                "A".repeat(64), UPLOADER, NOW));
        assertThrows(IllegalArgumentException.class, () -> Source.uploaded(WORKSPACE, name, SourceType.PDF, 1, key,
                "abc", UPLOADER, NOW));
        assertThrows(IllegalArgumentException.class, () -> Source.uploaded(WORKSPACE, name, SourceType.PDF, 1, key,
                null, UPLOADER, NOW));
    }

    @Test
    void requiresADisplayNameWithinTheColumn() {
        StorageKey key = StorageKey.generate();
        SourceFilename name = SourceFilename.of("r.pdf");
        assertThrows(IllegalArgumentException.class, () -> new Source(null, WORKSPACE, name, "  ", SourceType.PDF,
                1, key, SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW, NOW, UUID.randomUUID(), 1));
        assertThrows(IllegalArgumentException.class, () -> new Source(null, WORKSPACE, name, null, SourceType.PDF,
                1, key, SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW, NOW, UUID.randomUUID(), 1));
        assertThrows(IllegalArgumentException.class, () -> new Source(null, WORKSPACE, name, "x".repeat(256),
                SourceType.PDF, 1, key, SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW, NOW, UUID.randomUUID(), 1));
        assertEquals("Trimmed", new Source(null, WORKSPACE, name, "  Trimmed ", SourceType.PDF, 1, key, SHA,
                SourceStatus.UPLOADED, null, UPLOADER, NOW, NOW, UUID.randomUUID(), 1).displayName());
    }

    @Test
    void requiresAWorkspaceAndAnUploader() {
        StorageKey key = StorageKey.generate();
        SourceFilename name = SourceFilename.of("r.pdf");
        assertThrows(NullPointerException.class,
                () -> Source.uploaded(null, name, SourceType.PDF, 1, key, SHA, UPLOADER, NOW));
        assertThrows(NullPointerException.class,
                () -> Source.uploaded(WORKSPACE, name, SourceType.PDF, 1, key, SHA, null, NOW));
    }

    @Test
    void movesThroughProcessingToReady() {
        Source processing = uploaded().moveTo(SourceStatus.PROCESSING, LATER);
        Source ready = processing.moveTo(SourceStatus.READY, LATER);

        assertEquals(SourceStatus.READY, ready.status());
        assertEquals(LATER, ready.updatedAt());
        assertEquals(NOW, ready.createdAt());
        assertEquals(uploaded().sizeBytes(), ready.sizeBytes(), "the input is untouched by processing");
    }

    @Test
    void aFailedSourceMayBeProcessedAgainButAReadyOneIsFinal() {
        Source failed = uploaded().moveTo(SourceStatus.PROCESSING, LATER)
                .processingFailed("  The workbook is encrypted.  ", LATER);
        Source retrying = failed.moveTo(SourceStatus.PROCESSING, LATER);
        assertEquals("The workbook is encrypted.", failed.failureSummary());
        assertEquals(SourceStatus.PROCESSING, retrying.status());
        assertNull(retrying.failureSummary(), "retrying clears the previous attempt's failure");

        Source ready = uploaded().moveTo(SourceStatus.PROCESSING, LATER).moveTo(SourceStatus.READY, LATER);
        ConflictException refused = assertThrows(ConflictException.class,
                () -> ready.moveTo(SourceStatus.PROCESSING, LATER));
        assertTrue(refused.getMessage().contains("READY cannot become PROCESSING"), refused.getMessage());
    }

    @Test
    void explicitReprocessingKeepsOriginalBytesAndClearsFailure() {
        Source processing = uploaded().moveTo(SourceStatus.PROCESSING, LATER);
        for (Source completed : java.util.List.of(processing.moveTo(SourceStatus.READY, LATER),
                processing.processingFailed("Safe error", LATER))) {
            Source again = completed.reprocess(LATER);
            assertEquals(SourceStatus.PROCESSING, again.status());
            assertNull(again.failureSummary());
            assertEquals(completed.storageKey(), again.storageKey());
            assertEquals(completed.contentSha256(), again.contentSha256());
            assertEquals(completed.createdAt(), again.createdAt());
        }
        assertThrows(ConflictException.class, () -> uploaded().reprocess(LATER));
        assertThrows(ConflictException.class, () -> processing.reprocess(LATER));
    }

    @Test
    void skippingProcessingIsRefused() {
        assertThrows(ConflictException.class, () -> uploaded().moveTo(SourceStatus.READY, LATER));
        assertThrows(ConflictException.class, () -> uploaded().processingFailed("Failed", LATER));
        assertThrows(ConflictException.class, () -> uploaded().moveTo(SourceStatus.UPLOADED, LATER));
    }

    @Test
    void failureSummaryIsRequiredOnlyForFailedSourcesAndIsBounded() {
        Source processing = uploaded().moveTo(SourceStatus.PROCESSING, LATER);

        assertThrows(IllegalArgumentException.class, () -> processing.processingFailed("  ", LATER));
        assertThrows(IllegalArgumentException.class,
                () -> processing.processingFailed("x".repeat(Source.FAILURE_SUMMARY_MAX_LENGTH + 1), LATER));
        assertThrows(IllegalArgumentException.class, () -> new Source(null, WORKSPACE,
                SourceFilename.of("r.pdf"), "r.pdf", SourceType.PDF, 1, StorageKey.generate(), SHA,
                SourceStatus.UPLOADED, "not applicable", UPLOADER, NOW, NOW, UUID.randomUUID(), 1));
        assertThrows(IllegalArgumentException.class, () -> processing.moveTo(SourceStatus.FAILED, LATER));
    }

    @Test
    void theLifecycleTableIsExactlyTheDocumentedOne() {
        assertEquals(java.util.Set.of(SourceStatus.PROCESSING), SourceStatus.UPLOADED.next());
        assertEquals(java.util.Set.of(SourceStatus.READY, SourceStatus.FAILED), SourceStatus.PROCESSING.next());
        assertEquals(java.util.Set.of(SourceStatus.PROCESSING), SourceStatus.FAILED.next());
        assertEquals(java.util.Set.of(), SourceStatus.READY.next());
    }

    @Test
    void storageKeysAreRandomAndContainNothingTheUserChose() {
        StorageKey first = StorageKey.generate();
        StorageKey second = StorageKey.generate();

        assertNotEquals(first, second);
        assertTrue(first.value().matches("^sources/[0-9a-f-]{36}$"), first.value());
        assertEquals(first.value(), first.toString());
    }

    @Test
    void aStorageKeyThatThisApplicationDidNotGenerateIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> new StorageKey(null));
        assertThrows(IllegalArgumentException.class, () -> new StorageKey("sources/../../etc/passwd"));
        assertThrows(IllegalArgumentException.class, () -> new StorageKey("sources/report.pdf"));
        assertThrows(IllegalArgumentException.class,
                () -> new StorageKey("workspaces/" + UUID.randomUUID() + "/report.pdf"));
        assertThrows(IllegalArgumentException.class,
                () -> new StorageKey("sources/" + UUID.randomUUID().toString().toUpperCase()));
    }


    // --- RH-130 versions ---

    @Test
    void anUploadStartsAtVersionOneWithAFreshVersionIdentity() {
        Source first = uploaded();
        Source second = uploaded();

        assertEquals(1, first.activeVersionNumber());
        assertNotEquals(first.activeVersionId(), second.activeVersionId());
        assertThrows(NullPointerException.class, () -> new Source(null, WORKSPACE, SourceFilename.of("r.pdf"),
                "r.pdf", SourceType.PDF, 1, StorageKey.generate(), SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW,
                NOW, null, 1));
        assertThrows(IllegalArgumentException.class, () -> new Source(null, WORKSPACE, SourceFilename.of("r.pdf"),
                "r.pdf", SourceType.PDF, 1, StorageKey.generate(), SHA, SourceStatus.UPLOADED, null, UPLOADER, NOW,
                NOW, UUID.randomUUID(), 0));
    }

    @Test
    void replacingSelectsANewVersionAndLeavesTheStableIdentityAlone() {
        Source ready = withId().moveTo(SourceStatus.PROCESSING, LATER).moveTo(SourceStatus.READY, LATER);
        StorageKey key = StorageKey.generate();
        UUID newVersion = UUID.randomUUID();
        UUID reviser = UUID.randomUUID();

        Source replaced = ready.replaceWith(newVersion, 2, SourceFilename.of("r-v2.xlsx"), SourceType.XLSX, 2048,
                key, "b".repeat(64), reviser, LATER.plusSeconds(60));

        assertEquals(ready.id(), replaced.id());
        assertEquals(ready.createdAt(), replaced.createdAt());
        assertEquals(ready.displayName(), replaced.displayName(), "the label the workspace chose is kept");
        assertEquals(2, replaced.activeVersionNumber());
        assertEquals(newVersion, replaced.activeVersionId());
        assertEquals(key, replaced.storageKey());
        assertEquals(SourceType.XLSX, replaced.sourceType());
        assertEquals(SourceStatus.UPLOADED, replaced.status());
        assertEquals(reviser, replaced.uploadedBy());
        assertEquals(1, ready.activeVersionNumber(), "the earlier projection is untouched");
    }

    @Test
    void aSourceCanBeReplacedAfterAFailedRunButNotWhileItIsBeingProcessed() {
        Source failed = withId().moveTo(SourceStatus.PROCESSING, LATER).processingFailed("Broken", LATER);
        assertEquals(2, failed.replaceWith(UUID.randomUUID(), 2, SourceFilename.of("fixed.pdf"), SourceType.PDF, 9,
                StorageKey.generate(), SHA, UPLOADER, LATER).activeVersionNumber());

        Source processing = withId().moveTo(SourceStatus.PROCESSING, LATER);
        assertThrows(ConflictException.class, () -> processing.replaceWith(UUID.randomUUID(), 2,
                SourceFilename.of("x.pdf"), SourceType.PDF, 9, StorageKey.generate(), SHA, UPLOADER, LATER));
        assertThrows(ConflictException.class, () -> withId().replaceWith(UUID.randomUUID(), 2,
                SourceFilename.of("x.pdf"), SourceType.PDF, 9, StorageKey.generate(), SHA, UPLOADER, LATER));
    }

    @Test
    void versionNumbersAreConsecutive() {
        Source ready = withId().moveTo(SourceStatus.PROCESSING, LATER).moveTo(SourceStatus.READY, LATER);
        assertThrows(IllegalArgumentException.class, () -> ready.replaceWith(UUID.randomUUID(), 3,
                SourceFilename.of("x.pdf"), SourceType.PDF, 9, StorageKey.generate(), SHA, UPLOADER, LATER));
        assertThrows(IllegalArgumentException.class, () -> ready.replaceWith(UUID.randomUUID(), 1,
                SourceFilename.of("x.pdf"), SourceType.PDF, 9, StorageKey.generate(), SHA, UPLOADER, LATER));
    }

    private static Source withId() {
        Source unsaved = uploaded();
        return new Source(UUID.randomUUID(), unsaved.workspaceId(), unsaved.originalFilename(), unsaved.displayName(),
                unsaved.sourceType(), unsaved.sizeBytes(), unsaved.storageKey(), unsaved.contentSha256(),
                unsaved.status(), null, unsaved.uploadedBy(), unsaved.createdAt(), unsaved.updatedAt(),
                unsaved.activeVersionId(), unsaved.activeVersionNumber());
    }

}
