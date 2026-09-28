package dev.researchhub.source.domain;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The type mapping in docs/development/sources.md, as code. */
class SourceTypeTest {

    private static SourceType resolve(String filename, String mediaType) {
        return SourceType.resolve(SourceFilename.of(filename), mediaType);
    }

    @ParameterizedTest
    @CsvSource({
            "report.pdf, application/pdf, PDF",
            "Report.PDF, application/pdf, PDF",
            "notes.docx, application/vnd.openxmlformats-officedocument.wordprocessingml.document, DOCX",
            "data.xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, XLSX",
            "data.csv, text/csv, CSV",
            "readme.txt, text/plain, TXT",
    })
    void recognisesEachSupportedTypeByExtensionAndCanonicalMediaType(String filename, String mediaType,
                                                                     SourceType expected) {
        assertEquals(expected, resolve(filename, mediaType));
    }

    @Test
    void theStoredMediaTypeIsCanonicalAndOnePerType() {
        assertEquals("application/pdf", SourceType.PDF.mediaType());
        assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                SourceType.DOCX.mediaType());
        assertEquals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                SourceType.XLSX.mediaType());
        assertEquals("text/csv", SourceType.CSV.mediaType());
        assertEquals("text/plain", SourceType.TXT.mediaType());
        for (SourceType type : SourceType.values()) {
            assertTrue(type.acceptedMediaTypes().contains(type.mediaType()));
            assertEquals(Optional.of(type), SourceType.forMediaType(type.mediaType()));
        }
        assertEquals(Optional.empty(), SourceType.forMediaType("image/png"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/vnd.ms-excel", "application/csv", "text/x-csv", "text/plain"})
    void acceptsWhatBrowsersActuallySendForCsv(String mediaType) {
        assertEquals(SourceType.CSV, resolve("data.csv", mediaType));
    }

    @Test
    void aMissingOrGenericMediaTypeLeavesTheDecisionToTheExtension() {
        assertEquals(SourceType.PDF, resolve("report.pdf", null));
        assertEquals(SourceType.PDF, resolve("report.pdf", "  "));
        assertEquals(SourceType.PDF, resolve("report.pdf", "application/octet-stream"));
    }

    @Test
    void mediaTypeParametersAndCaseAreIgnored() {
        assertEquals(SourceType.TXT, resolve("notes.txt", "Text/Plain; charset=UTF-8"));
    }

    @Test
    void anUnsupportedExtensionIsAClearError() {
        UnsupportedFileTypeException refused = assertThrows(UnsupportedFileTypeException.class,
                () -> resolve("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));

        assertEquals(ApiErrorCode.UNSUPPORTED_FILE_TYPE, refused.code());
        assertEquals("Files of type .pptx are not supported. "
                + "Supported types: PDF (.pdf), DOCX (.docx), XLSX (.xlsx), CSV (.csv), TXT (.txt).",
                refused.getMessage());
    }

    @Test
    void aFileWithoutAnExtensionIsAClearError() {
        UnsupportedFileTypeException refused = assertThrows(UnsupportedFileTypeException.class,
                () -> resolve("README", "text/plain"));

        assertTrue(refused.getMessage().startsWith("The file has no extension"), refused.getMessage());
        assertTrue(refused.getMessage().contains("Supported types:"));
    }

    @Test
    void aMediaTypeThatContradictsTheExtensionIsRefusedRatherThanGuessed() {
        UnsupportedFileTypeException refused = assertThrows(UnsupportedFileTypeException.class,
                () -> resolve("photo.pdf", "image/png"));

        assertTrue(refused.getMessage().contains("named .pdf but was sent as image/png"), refused.getMessage());
    }

    @Test
    void legacyOfficeFormatsAreNotSilentlyAccepted() {
        assertThrows(UnsupportedFileTypeException.class, () -> resolve("old.doc", "application/msword"));
        assertThrows(UnsupportedFileTypeException.class, () -> resolve("old.xls", "application/vnd.ms-excel"));
    }

    @Test
    void checksThePdfSignature() {
        assertTrue(SourceType.PDF.acceptsLeadingBytes("%PDF-1.7\n...".getBytes(StandardCharsets.US_ASCII)));
        assertFalse(SourceType.PDF.acceptsLeadingBytes("MZ\u0090\u0000".getBytes(StandardCharsets.ISO_8859_1)),
                "a Windows executable renamed to .pdf");
        assertFalse(SourceType.PDF.acceptsLeadingBytes(new byte[]{'%', 'P'}), "too short to be a PDF");
    }

    @Test
    void checksTheOfficeOpenXmlZipSignature() {
        byte[] zip = {'P', 'K', 3, 4, 20, 0};
        assertTrue(SourceType.DOCX.acceptsLeadingBytes(zip));
        assertTrue(SourceType.XLSX.acceptsLeadingBytes(zip));
        assertFalse(SourceType.DOCX.acceptsLeadingBytes("%PDF-1.7".getBytes(StandardCharsets.US_ASCII)));
        assertFalse(SourceType.XLSX.acceptsLeadingBytes(new byte[]{(byte) 0xD0, (byte) 0xCF, 0x11, (byte) 0xE0}),
                "a legacy .xls renamed to .xlsx");
    }

    @Test
    void textMustNotContainNulBytes() {
        assertTrue(SourceType.CSV.acceptsLeadingBytes("a,b\n1,2\n".getBytes(StandardCharsets.UTF_8)));
        assertTrue(SourceType.TXT.acceptsLeadingBytes("Zażółć gęślą jaźń".getBytes(StandardCharsets.UTF_8)));
        assertFalse(SourceType.TXT.acceptsLeadingBytes(new byte[]{'h', 0, 'i', 0}),
                "UTF-16 or binary content under a .txt name");
    }

    @Test
    void normalizesMediaTypes() {
        assertNull(SourceType.normalizeMediaType(null));
        assertNull(SourceType.normalizeMediaType(" ; charset=utf-8"));
        assertEquals("text/csv", SourceType.normalizeMediaType(" TEXT/CSV ;header=present"));
    }

}
