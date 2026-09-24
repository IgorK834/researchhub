package dev.researchhub.document.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * Body of {@code POST .../documents/{documentId}/versions/{versionId}/restore}.
 *
 * <p>{@code revision} is the document revision the caller is looking at, required for the same reason a save
 * requires it: a restore replaces the current text, so it must not replace text the caller has not seen. A stale
 * one is {@code 409} with {@code currentRevision}, exactly like a stale save.
 */
public record RestoreDocumentVersionRequest(
        @NotNull
        @Positive
        Long revision
) {
}
