package dev.researchhub.security.application;

import dev.researchhub.security.OfficeUploadFixture;
import dev.researchhub.shared.error.UnsupportedFileTypeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class UploadInspectorTest {
    @TempDir Path directory;
    final UploadInspector inspector = new UploadInspector(List.of());
    Path file(byte[] data) throws Exception { return Files.write(directory.resolve(UUID.randomUUID().toString()), data); }
    @Test void recognizesTheActualOfficeTypeAndRejectsGenericZipOrTruncatedPackage() throws Exception {
        Path valid = file(OfficeUploadFixture.xlsx());
        inspector.requireSafe(valid, "XLSX");
        assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(valid, "DOCX"));
        for (byte[] data : List.of(new byte[]{'P','K',3,4}, OfficeUploadFixture.archive(Map.of("notes.txt", "notes"))))
            assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(file(data), "XLSX"));
    }
    @Test void detectsWordPackagesAndRejectsMacroTypesExternalEntitiesAndZipBombs() throws Exception {
        String xml = "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
        inspector.requireSafe(file(OfficeUploadFixture.archive(Map.of("[Content_Types].xml", xml, "_rels/.rels", "<r/>", "word/document.xml", "<d/>"))), "DOCX");
        for (String invalid : List.of(xml.replace("document.main+xml", "document.macroEnabled.main+xml"),
                xml.replace("</Types>", "<Default Extension='bin' ContentType='application/vnd.ms-office.vba&#80;roject'/></Types>"),
                "<!DOCTYPE Types [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>" + xml,
                "x".repeat(65537), "<unclosed>")) {
            Path path = file(OfficeUploadFixture.archive(Map.of("[Content_Types].xml", invalid, "_rels/.rels", "<r/>", "word/document.xml", "<d/>")));
            assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(path, "DOCX"));
        }
        Path bomb = file(OfficeUploadFixture.archive(Map.of("word/document.xml", "x".repeat(2_000_000))));
        assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(bomb, "DOCX"));
    }
    @ParameterizedTest @ValueSource(strings={"../outside", "/absolute", "C:disk", "a\\b", "xl/vbaProject.bin", "xl/activeX/a.bin"})
    void rejectsPathLikeAndActiveOfficeParts(String name) throws Exception {
        Path path = file(OfficeUploadFixture.archive(Map.of(name, "content")));
        assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(path, "XLSX"));
        assertFalse(Files.exists(directory.resolve("outside")));
    }
    @ParameterizedTest @ValueSource(strings={"PKfakezip", "%PDF-1.7", "MZprogram", "Rar!", "7zarchive", "\u007fELF", "bad\u0001text", "bad\u0000text", "\u001f\u008bcompressed"})
    void refusesBinaryOrDisguisedDocumentsAsText(String value) throws Exception {
        Path path = file(value.getBytes(StandardCharsets.ISO_8859_1));
        assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(path, "TXT"));
    }
    @Test void checksUtf8AcrossTheWholeFileAndKeepsOrdinaryUnicodeText() throws Exception {
        inspector.requireSafe(file("λ 😀\tvalue\nrow\r\n".getBytes(StandardCharsets.UTF_8)), "CSV");
        byte[] bytes = new byte[9001]; Arrays.fill(bytes, (byte)'a'); bytes[9000] = (byte)0xff;
        assertThrows(UnsupportedFileTypeException.class, () -> inspector.requireSafe(file(bytes), "TXT"));
    }
    @Test void optionalScannerRunsOnlyAfterValidationAndFailsClosed() throws Exception {
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        var scanner = new UploadInspector(List.of(path -> { calls.incrementAndGet(); throw new UnsupportedFileTypeException("Scanner rejected upload"); }));
        assertThrows(UnsupportedFileTypeException.class, () -> scanner.requireSafe(file("hello".getBytes()), "TXT"));
        assertEquals(1, calls.get());
        assertThrows(UnsupportedFileTypeException.class, () -> scanner.requireSafe(file(new byte[]{'P','K'}), "TXT"));
        assertEquals(1, calls.get());
        inspector.requireSafe(file("%PDF-bad".getBytes()), "PDF"); // Structural PDF parsing belongs to the isolated worker.
    }
}
