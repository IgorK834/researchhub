package dev.researchhub.source.application;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MeteredInputStreamTest {

    /** SHA-256 of "hello". */
    private static final String HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    private static InputStream text(String value) {
        return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void countsAndHashesWhatIsRead() throws IOException {
        MeteredInputStream metered = new MeteredInputStream(text("hello"), 5);

        assertEquals("hello", new String(metered.readAllBytes(), StandardCharsets.UTF_8));
        assertEquals(5, metered.count());
        assertEquals(HELLO_SHA256, metered.sha256Hex());
    }

    @Test
    void singleByteReadsAreCountedAndHashedToo() throws IOException {
        MeteredInputStream metered = new MeteredInputStream(text("hello"), 10);
        while (metered.read() >= 0) {
            // drain byte by byte
        }

        assertEquals(5, metered.count());
        assertEquals(HELLO_SHA256, metered.sha256Hex());
    }

    @Test
    void stopsAssoonAsTheLimitIsPassed() {
        MeteredInputStream metered = new MeteredInputStream(text("hello world"), 5);

        ContentLimitExceededException exceeded = assertThrows(ContentLimitExceededException.class,
                metered::readAllBytes);
        assertEquals(5, exceeded.limitBytes());
    }

    @Test
    void skippedBytesStillCount() throws IOException {
        MeteredInputStream metered = new MeteredInputStream(text("hello"), 10);

        assertEquals(3, metered.skip(3));
        metered.readAllBytes();

        assertEquals(5, metered.count());
        assertEquals(HELLO_SHA256, metered.sha256Hex());
        assertEquals(0, metered.skip(-1));
    }

    @Test
    void doesNotSupportMarkBecauseAReplayedByteWouldCountTwice() {
        MeteredInputStream metered = new MeteredInputStream(text("hello"), 10);
        metered.mark(3);

        assertFalse(metered.markSupported());
        assertThrows(IOException.class, metered::reset);
    }

    @Test
    void refusesANegativeLimit() {
        assertThrows(IllegalArgumentException.class, () -> new MeteredInputStream(text(""), -1));
    }

}
