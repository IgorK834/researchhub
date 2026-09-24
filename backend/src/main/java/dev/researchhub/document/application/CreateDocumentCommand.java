package dev.researchhub.document.application;

/**
 * Request to create a document in a workspace.
 *
 * <p>The workspace and the author are parameters of {@link DocumentService#create}: one comes from the path and
 * the other from the session, and neither is payload a client gets to shape. A body that could name its own
 * author would let one member attribute work to another.
 *
 * <p>{@code content} is the JSON text to store. There is no format field — every document is
 * {@code PROSEMIRROR_JSON}, decided by the domain rather than requested.
 */
public record CreateDocumentCommand(String title, String content) {
}
