package dev.researchhub.source.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** A file name is metadata, cleaned so it cannot mislead a reader or be mistaken for a path. */
class SourceFilenameTest {

    @Test
    void keepsAnOrdinaryNameAsItIs() {
        assertEquals("Lab report (final).pdf", SourceFilename.of("Lab report (final).pdf").value());
    }

    @ParameterizedTest
    @ValueSource(strings = {"../../etc/passwd.txt", "C:\\Users\\ada\\passwd.txt", "/tmp/x/passwd.txt"})
    void dropsAnyDirectoryPart(String raw) {
        assertEquals("passwd.txt", SourceFilename.of(raw).value());
    }

    @Test
    void removesControlCharactersAndBidirectionalOverrides() {
        assertEquals("gpj.exe", SourceFilename.of("\u202Egpj.exe").value(),
                "a right-to-left override would display this as exe.jpg");
        assertEquals("line.txt", SourceFilename.of("li\nne\u0000.txt").value());
    }

    @Test
    void normalisesUnicodeSoTheSameVisibleNameIsTheSameString() {
        String decomposed = "Ba\u0301rbara.txt";
        assertEquals("B\u00e1rbara.txt", SourceFilename.of(decomposed).value());
    }

    @Test
    void trimsSurroundingWhitespace() {
        assertEquals("notes.txt", SourceFilename.of("  notes.txt \t").value());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "   ", ".", "..", "folder/", "\u202E"})
    void refusesANameWithNothingUsableLeft(String raw) {
        assertThrows(IllegalArgumentException.class, () -> SourceFilename.of(raw));
    }

    @Test
    void refusesANameLongerThanTheColumn() {
        String name = "a".repeat(252) + ".txt";
        assertThrows(IllegalArgumentException.class, () -> SourceFilename.of(name));
        assertEquals(255, SourceFilename.of("a".repeat(251) + ".txt").value().length());
    }

    @Test
    void theConstructorOnlyAcceptsAnAlreadyCleanedName() {
        assertThrows(IllegalArgumentException.class, () -> new SourceFilename("../x.txt"));
        assertThrows(IllegalArgumentException.class, () -> new SourceFilename(" "));
        assertEquals("x.txt", new SourceFilename("x.txt").value());
    }

    @Test
    void readsTheExtensionLowercase() {
        assertEquals(Optional.of("pdf"), SourceFilename.of("Report.PDF").extension());
        assertEquals(Optional.of("gz"), SourceFilename.of("archive.tar.gz").extension());
        assertEquals(Optional.empty(), SourceFilename.of("README").extension());
        assertEquals(Optional.empty(), SourceFilename.of(".bashrc").extension(), "a dotfile has no extension");
        assertEquals(Optional.empty(), SourceFilename.of("trailing.").extension());
    }

}
