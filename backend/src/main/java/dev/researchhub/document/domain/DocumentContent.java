package dev.researchhub.document.domain;

import dev.researchhub.shared.validation.FieldLengths;

import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * A document's content, as the JSON text that is stored.
 *
 * <p>Holds the serialized form rather than a parsed tree, so this type needs no JSON library and the module's
 * domain stays free of one. Whether the content is a JSON <em>object</em> is checked where the parsed value
 * already exists — at the HTTP boundary, for a field-level 400 — and again by
 * {@code ck_documents_content_is_object}, which is what actually guarantees it for every writer. What this
 * type owns is the bound that has to hold regardless of caller: a document is not an unbounded blob.
 *
 * <p>The size limit is in bytes, measured on UTF-8, because that is what the column and the response have to
 * carry. It matters now precisely because nothing else bounds it: without chunking or a CRDT, every save
 * sends and stores the entire document.
 *
 * <p>Two factories, mirroring {@code PasswordHash}: {@link #of} validates content arriving from a caller, and
 * {@link #ofStoredJson} trusts a value that has already been through the column's constraints. A read must
 * not fail because a bound was later tightened.
 */
public record DocumentContent(String json) {

    public DocumentContent {
        Objects.requireNonNull(json, "content must not be null");
        if (json.isBlank()) {
            throw new IllegalArgumentException("content must not be blank");
        }
    }

    /**
     * Content supplied by a caller.
     *
     * @throws IllegalArgumentException when it is blank, or larger than
     *                                  {@link FieldLengths#DOCUMENT_CONTENT_MAX_BYTES} as UTF-8
     */
    public static DocumentContent of(String json) {
        DocumentContent content = new DocumentContent(json);
        int bytes = content.sizeInBytes();
        if (bytes > FieldLengths.DOCUMENT_CONTENT_MAX_BYTES) {
            throw new IllegalArgumentException("content must be at most "
                    + FieldLengths.DOCUMENT_CONTENT_MAX_BYTES + " bytes, but was " + bytes);
        }
        return content;
    }

    /**
     * Content read back from the database, which has already satisfied the column's constraints.
     *
     * <p>Checks only that something is there. Re-applying the size bound here would mean a document could
     * become unreadable if the limit were ever lowered, turning a configuration change into data loss.
     */
    public static DocumentContent ofStoredJson(String json) {
        return new DocumentContent(json);
    }

    /** Size of the serialized content in UTF-8 bytes, which is what the limit is expressed in. */
    public int sizeInBytes() {
        return json.getBytes(StandardCharsets.UTF_8).length;
    }

}
