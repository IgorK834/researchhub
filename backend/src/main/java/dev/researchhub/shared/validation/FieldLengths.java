package dev.researchhub.shared.validation;

/**
 * Shared maximum lengths for user-entered text.
 *
 * <p>Defined here, before any database column exists, so every module reuses the same
 * numbers on its API request DTOs instead of inventing new ones. When a module adds a
 * table for one of these concepts, its column length must be at least this large. See
 * docs/development/validation.md for the full table and the reasoning behind each value.
 */
public final class FieldLengths {

    /** Short display names: workspace names, user display names, and similar identifiers. */
    public static final int NAME_MAX = 255;

    /**
     * Email addresses, whole address including the domain.
     *
     * <p>254 is the longest address that can actually be delivered: RFC 5321 limits a
     * {@code MAIL FROM} path to 256 characters including the enclosing angle brackets. The
     * 320-character figure sometimes quoted adds the theoretical 64-character local part to a
     * 255-character domain and is not deliverable, so it would only widen the column without
     * accepting a usable address.
     */
    public static final int EMAIL_MAX = 254;

    /** Document and other titles. */
    public static final int TITLE_MAX = 500;

    /**
     * Optional free-text descriptions: a workspace description and similar explanatory metadata.
     *
     * <p>Deliberately far smaller than {@link #COMMENT_MAX}. A description is metadata rendered
     * alongside the thing it describes, often in a list, so it has to stay readable at a glance; a
     * comment is discussion and can reasonably run long. Reusing the comment limit here would invite
     * descriptions no list can display.
     */
    public static final int DESCRIPTION_MAX = 2000;

    /** AI user prompts. */
    public static final int PROMPT_MAX = 8000;

    /** Comment bodies. */
    public static final int COMMENT_MAX = 4000;

    private FieldLengths() {
    }

}
