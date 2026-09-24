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
     * <p>The frontend editor is Tiptap, and a save stores its {@code getJSON()} as it is. Documents written by
     * the earlier textarea editor are a {@code doc} of paragraphs, which Tiptap opens without a migration. The
     * backend does not validate the full ProseMirror schema, so a new Tiptap node or mark needs no change here.
     *
     * <p>This value is the version tag. There is deliberately no {@code schemaVersion} inside the JSON. A future
     * shape that existing rows would not fit is a new value of this enum plus a Flyway migration, never an
     * in-place rewrite of the column and never a conversion to HTML (docs/development/persistence.md).
     */
    PROSEMIRROR_JSON

}
