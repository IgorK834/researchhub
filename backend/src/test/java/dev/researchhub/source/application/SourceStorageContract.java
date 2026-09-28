package dev.researchhub.source.application;

import dev.researchhub.source.domain.StorageKey;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * What every {@link SourceStorage} adapter must do, as tests. An adapter's test class extends this and supplies
 * {@link #storage()}; the local adapter (RH-072) and an Azure adapter run the same checks, which is what "an adapter
 * can be added without changing the source rules" means in practice.
 */
public abstract class SourceStorageContract {

    /** A fresh, empty storage for one test. */
    protected abstract SourceStorage storage();

    private static InputStream bytes(String value) {
        return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void storesAndReadsBackTheSameBytes() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();

        storage.store(key, bytes("Measured at 21 °C"), "text/plain");

        assertTrue(storage.exists(key));
        try (InputStream read = storage.open(key)) {
            assertArrayEquals("Measured at 21 °C".getBytes(StandardCharsets.UTF_8), read.readAllBytes());
        }
    }

    @Test
    void storesLargerThanOneBufferWithoutLosingBytes() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();
        byte[] large = new byte[3 * 1024 * 1024 + 17];
        for (int index = 0; index < large.length; index++) {
            large[index] = (byte) (index * 31);
        }

        storage.store(key, new ByteArrayInputStream(large), "application/pdf");

        try (InputStream read = storage.open(key)) {
            assertArrayEquals(large, read.readAllBytes());
        }
    }

    @Test
    void neverOverwritesAnExistingObject() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();
        storage.store(key, bytes("original"), "text/plain");

        assertThrows(IOException.class, () -> storage.store(key, bytes("replacement"), "text/plain"));

        try (InputStream read = storage.open(key)) {
            assertEquals("original", new String(read.readAllBytes(), StandardCharsets.UTF_8),
                    "the original input is immutable in storage too");
        }
    }

    @Test
    void propagatesAFailureFromTheContentStream() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();
        InputStream limited = new MeteredInputStream(bytes("more than four bytes"), 4);

        assertThrows(ContentLimitExceededException.class, () -> storage.store(key, limited, "text/plain"));

        storage.delete(key);
        assertFalse(storage.exists(key), "nothing readable is left once the caller cleans up");
    }

    @Test
    void reportsAMissingObjectDistinctly() throws IOException {
        SourceStorage storage = storage();
        StorageKey missing = StorageKey.generate();

        assertFalse(storage.exists(missing));
        assertThrows(StorageObjectNotFoundException.class, () -> storage.open(missing));
    }

    @Test
    void deletesIdempotently() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();
        storage.store(key, bytes("x"), "text/plain");

        storage.delete(key);
        storage.delete(key);

        assertFalse(storage.exists(key));
    }

    @Test
    void temporaryReadAccessWhenOfferedExpires() throws IOException {
        SourceStorage storage = storage();
        StorageKey key = StorageKey.generate();
        storage.store(key, bytes("x"), "text/plain");

        storage.createTemporaryReadAccess(key, Duration.ofMinutes(5)).ifPresent(access ->
                assertTrue(access.expiresAt().isBefore(Instant.now().plus(Duration.ofMinutes(6))),
                        "a signed URL must be short-lived"));
    }

}
