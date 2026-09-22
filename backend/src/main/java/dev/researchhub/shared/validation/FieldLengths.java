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

    /** Document and other titles. */
    public static final int TITLE_MAX = 500;

    /** AI user prompts. */
    public static final int PROMPT_MAX = 8000;

    /** Comment bodies. */
    public static final int COMMENT_MAX = 4000;

    private FieldLengths() {
    }

}
