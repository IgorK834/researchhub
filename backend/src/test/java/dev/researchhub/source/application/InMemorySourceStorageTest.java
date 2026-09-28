package dev.researchhub.source.application;

import dev.researchhub.source.domain.StorageKey;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** The test adapter meets the same contract a real one must. */
class InMemorySourceStorageTest extends SourceStorageContract {

    @Override
    protected SourceStorage storage() {
        return new InMemorySourceStorage();
    }

    @Test
    void canBeToldToFail() throws IOException {
        InMemorySourceStorage storage = new InMemorySourceStorage();
        StorageKey key = StorageKey.generate();

        storage.failNextStore();
        assertThrows(IOException.class, () -> storage.store(key, new ByteArrayInputStream(new byte[]{1}), "x"));
        storage.failDeletes(true);
        assertThrows(IOException.class, () -> storage.delete(key));
        storage.clear();
        assertEquals(0, storage.objectCount());
    }

    @Test
    void temporaryReadAccessRequiresAUriAndAnExpiry() {
        assertThrows(NullPointerException.class, () -> new TemporaryReadAccess(null, Instant.now()));
        assertThrows(NullPointerException.class, () -> new TemporaryReadAccess(URI.create("https://x"), null));
    }

}
