package dev.researchhub.document.application;

import java.util.Objects;

/**
 * Request to save a new revision of a document.
 *
 * <p>{@code expectedRevision} is the revision the editor last saw. It is required, not optional: a save with no
 * idea what it is replacing is exactly the write that silently destroys somebody else's paragraph, so there is
 * no way to express one.
 *
 * <p>{@code saveKind} decides only whether the save is snapshotted ({@link CheckpointPolicy}); the rules for the
 * save itself are the same either way.
 */
public record ReviseDocumentCommand(String title, String content, long expectedRevision, SaveKind saveKind) {

    public ReviseDocumentCommand {
        Objects.requireNonNull(saveKind, "saveKind must not be null");
    }

}
