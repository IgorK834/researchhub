package dev.researchhub.document.application;

/**
 * Who decided a save should happen: the person, or the editor on their behalf.
 *
 * <p>Both are saves under the same rules — the same revision check and the same authorization. The difference is
 * only whether the save is a milestone worth a restore point (see {@link CheckpointPolicy}).
 */
public enum SaveKind {

    /** The user asked for it. Always recorded as a version. */
    MANUAL,

    /** The editor saved after the user stopped typing. Recorded only when a checkpoint is due. */
    AUTOSAVE

}
