package dev.researchhub.document.domain;

import dev.researchhub.shared.validation.FieldLengths;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The one rule {@link DocumentContent} owns: a document is bounded.
 *
 * <p>Worth its own test because the bound is in bytes rather than characters, and those differ for exactly the
 * text most likely to be near the limit.
 */
class DocumentContentTest {

    /** Padding that makes a valid JSON object of a chosen size. */
    private static String contentOfBytes(int totalBytes) {
        String prefix = "{\"type\":\"doc\",\"text\":\"";
        String suffix = "\"}";
        return prefix + "a".repeat(totalBytes - prefix.length() - suffix.length()) + suffix;
    }

    @Test
    void acceptsAnOrdinaryDocument() {
        DocumentContent content = DocumentContent.of(
                "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}");

        assertTrue(content.json().startsWith("{"));
        assertEquals(content.json().length(), content.sizeInBytes(), "ASCII: one byte per character");
    }

    @Test
    void rejectsBlankContent() {
        assertThrows(NullPointerException.class, () -> DocumentContent.of(null));
        assertThrows(IllegalArgumentException.class, () -> DocumentContent.of(""));
        assertThrows(IllegalArgumentException.class, () -> DocumentContent.of("   "));
    }

    @Test
    void acceptsContentExactlyAtTheLimit() {
        String atLimit = contentOfBytes(FieldLengths.DOCUMENT_CONTENT_MAX_BYTES);

        assertEquals(FieldLengths.DOCUMENT_CONTENT_MAX_BYTES,
                DocumentContent.of(atLimit).sizeInBytes());
    }

    @Test
    void rejectsContentOverTheLimit() {
        String overLimit = contentOfBytes(FieldLengths.DOCUMENT_CONTENT_MAX_BYTES + 1);

        IllegalArgumentException tooLarge = assertThrows(IllegalArgumentException.class,
                () -> DocumentContent.of(overLimit));

        assertTrue(tooLarge.getMessage().contains(String.valueOf(
                        FieldLengths.DOCUMENT_CONTENT_MAX_BYTES)),
                "The message should name the limit, but was: " + tooLarge.getMessage());
    }

    /**
     * The reason the limit is in bytes. A document of non-ASCII prose is larger encoded than its character
     * count suggests, and the column and the response carry the encoded form.
     */
    @Test
    void measuresMultiByteCharactersByTheirEncodedSize() {
        String polish = "{\"text\":\"" + "ł".repeat(100) + "\"}";

        DocumentContent content = DocumentContent.of(polish);

        assertEquals(polish.getBytes(StandardCharsets.UTF_8).length, content.sizeInBytes());
        assertTrue(content.sizeInBytes() > polish.length(),
                "Two bytes per character here, so a character count would under-measure the row");
    }

    @Test
    void storedContentIsTrustedRatherThanRemeasured() {
        String overLimit = contentOfBytes(FieldLengths.DOCUMENT_CONTENT_MAX_BYTES + 1);

        // Reading must not fail because a bound was tightened after the row was written; the column's own
        // check constraint is what keeps oversize content out in the first place.
        assertEquals(overLimit, DocumentContent.ofStoredJson(overLimit).json());
        assertThrows(IllegalArgumentException.class, () -> DocumentContent.ofStoredJson("  "),
                "though a row with nothing in it is still a bug worth failing on");
    }

}
