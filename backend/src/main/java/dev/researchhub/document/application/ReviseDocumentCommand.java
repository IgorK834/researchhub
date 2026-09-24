package dev.researchhub.document.application;

/**
 * Request to save a new revision of a document.
 *
 * <p>{@code expectedRevision} is the revision the editor last saw. It is required, not optional: a save with no
 * idea what it is replacing is exactly the write that silently destroys somebody else's paragraph, so there is
 * no way to express one.
 */
public record ReviseDocumentCommand(String title, String content, long expectedRevision) {
}
