package dev.researchhub.document.domain;

/**
 * Why a {@link DocumentVersion} was taken.
 *
 * <p>Pinned by {@code ck_document_versions_reason}. Adding a value means widening that constraint in a new
 * migration.
 */
public enum DocumentVersionReason {

    /** The first revision, recorded when the document is created. */
    CREATED,

    /** A save the user asked for explicitly. Always a milestone. */
    MANUAL_SAVE,

    /** An autosave that landed after the newest snapshot had aged past the checkpoint interval. */
    AUTOSAVE_CHECKPOINT,

    /** The revision produced by restoring an older snapshot. Records which one. */
    RESTORE,

    /** A human explicitly accepted an AI authoring suggestion. */
    MANUAL_SNAPSHOT,

    SCHEDULED_SNAPSHOT,

    AI_ACCEPTANCE

}
