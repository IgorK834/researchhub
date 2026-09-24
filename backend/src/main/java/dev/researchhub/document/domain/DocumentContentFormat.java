package dev.researchhub.document.domain;

/**
 * How a document's stored content is to be interpreted.
 *
 * <p>One value, and the single value is the point. Every document in the installation has the same shape, so
 * a reader never has to branch on the format, and there is no path by which HTML or plain text enters the
 * column — a format that could carry markup would make every renderer a sanitizer.
 *
 * <p>Adding a value here means widening {@code ck_documents_content_format} in a new migration, the same way
 * {@code WorkspaceRole} is pinned by {@code ck_workspace_members_role}.
 */
public enum DocumentContentFormat {

    /**
     * A ProseMirror document node, as JSON: an object with a {@code type} of {@code doc} and a
     * {@code content} array.
     *
     * <p>Chosen now because docs/context.md section 9 names Tiptap and ProseMirror as the eventual editor, so
     * storing their document shape from the start means the editor can be introduced without migrating the
     * content. Nothing validates the full ProseMirror schema, and nothing renders it with an editor
     * framework yet — the current UI reads and writes the paragraph text inside it.
     */
    PROSEMIRROR_JSON

}
