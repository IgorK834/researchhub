package dev.researchhub.source.application;

import dev.researchhub.source.domain.StorageKey;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A test adapter for {@link SourceStorage}: objects in a map.
 *
 * <p>Reads the upload in small chunks, as a real adapter streams, so the metering in {@link SourceService} is
 * exercised the way it will be in production. Can be told to fail its next store or its deletes, to test the
 * service's clean-up paths. Passes {@link SourceStorageContract}, which a real adapter must pass too.
 */
public class InMemorySourceStorage implements SourceStorage {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();
    private final AtomicBoolean failNextStore = new AtomicBoolean();
    private final AtomicBoolean failDeletes = new AtomicBoolean();

    @Override
    public void store(StorageKey key, InputStream content, String mediaType) throws IOException {
        if (objects.containsKey(key.value())) {
            throw new IOException("An object is already stored at " + key);
        }
        ByteArrayOutputStream written = new ByteArrayOutputStream();
        byte[] chunk = new byte[1024];
        int read;
        while ((read = content.read(chunk)) >= 0) {
            written.write(chunk, 0, read);
            if (failNextStore.compareAndSet(true, false)) {
                throw new IOException("The storage backend went away");
            }
        }
        objects.put(key.value(), written.toByteArray());
    }

    @Override
    public InputStream open(StorageKey key) throws IOException {
        byte[] stored = objects.get(key.value());
        if (stored == null) {
            throw new StorageObjectNotFoundException(key);
        }
        return new ByteArrayInputStream(stored);
    }

    @Override
    public boolean exists(StorageKey key) {
        return objects.containsKey(key.value());
    }

    @Override
    public void delete(StorageKey key) throws IOException {
        if (failDeletes.get()) {
            throw new IOException("Deletes are failing");
        }
        objects.remove(key.value());
    }

    @Override
    public Optional<TemporaryReadAccess> createTemporaryReadAccess(StorageKey key, Duration ttl) {
        return Optional.empty();
    }

    public void failNextStore() {
        failNextStore.set(true);
    }

    public void failDeletes(boolean fail) {
        failDeletes.set(fail);
    }

    public int objectCount() {
        return objects.size();
    }

    public void clear() {
        objects.clear();
        failNextStore.set(false);
        failDeletes.set(false);
    }

}
