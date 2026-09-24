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

    /**
     * Maximum serialized size of one document's JSON content, in <strong>bytes</strong> rather than
     * characters.
     *
     * <p>The odd unit out in this class, and deliberately so: the value stored is a JSON document, and what
     * a row and a response can afford is its encoded size. A character count would be the wrong bound for
     * text that may be mostly non-ASCII.
     *
     * <p>One megabyte is far more prose than a report section, and small enough that a document stays a row
     * rather than a blob. The limit exists because nothing else bounds it yet: there is no chunking, no
     * incremental update, and no CRDT, so every save sends and stores the whole document. When that changes,
     * this number should be revisited rather than quietly raised.
     */
    public static final int DOCUMENT_CONTENT_MAX_BYTES = 1_000_000;

    /** AI user prompts. */
    public static final int PROMPT_MAX = 8000;

    /** Comment bodies. */
    public static final int COMMENT_MAX = 4000;

    private FieldLengths() {
    }

}
