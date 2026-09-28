package dev.researchhub.source.application;

import dev.researchhub.source.domain.StorageKey;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Optional;

/**
 * Where source bytes are kept. The port the {@code source} module owns; adapters live in
 * {@code source.infrastructure} and are chosen by {@code researchhub.sources.storage.adapter}.
 *
 * <p>The contract is written in {@link StorageKey}s, never URLs, container names, or credentials. Those are the
 * adapter's configuration. The Azure Blob implementation talks to Azurite locally and can be pointed at Azure
 * without the source rules — what is accepted, who may read it, what is immutable — changing at all.
 *
 * <p>Size limits and the content hash are <em>not</em> the adapter's job. {@link SourceService} meters the stream
 * it hands to {@link #store}, so every adapter enforces the same limit and produces the same digest by
 * construction.
 *
 * <p>Implementations must be safe to call concurrently. None of these methods authorizes anything: the caller has
 * already found the source in the caller's workspace, and the key came from that row.
 */
public interface SourceStorage {

    /**
     * Streams {@code content} into a new object at {@code key}.
     *
     * <p>Must stream: read {@code content} in chunks and write them out, never buffering the whole file in memory.
     * Must not overwrite: a key is generated once, so an existing object at {@code key} is an error. If
     * {@code content} throws while being read — including because it exceeded the size limit — the adapter must
     * propagate that exception and leave no readable object behind, or leave one the caller's {@link #delete}
     * removes.
     *
     * @param mediaType the canonical media type, for adapters that record one (a blob's content type)
     * @throws IOException when the bytes could not be read or written
     */
    void store(StorageKey key, InputStream content, String mediaType) throws IOException;

    /**
     * Opens the object for reading. The caller closes the stream.
     *
     * @throws StorageObjectNotFoundException when nothing is stored at {@code key}
     * @throws IOException                    when it exists but cannot be opened
     */
    InputStream open(StorageKey key) throws IOException;

    /** Whether an object is stored at {@code key}. */
    boolean exists(StorageKey key) throws IOException;

    /**
     * Removes the object at {@code key}, if there is one. Idempotent.
     *
     * <p><strong>Administrative lifecycle only</strong>: cleaning up after a failed upload, or a deliberate
     * retention decision. Sources are not deleted as part of ordinary use, and nothing in the product removes one
     * that is still referenced.
     */
    void delete(StorageKey key) throws IOException;

    /**
     * A short-lived, pre-authorized way to read the object directly from storage, when the adapter has one — a
     * SAS URL for Azure Blob, for example.
     *
     * <p>Empty when the adapter cannot offer it, in which case the caller streams the bytes through the API via
     * {@link #open}. Only ever requested after the caller's access to the source has been checked; the result
     * must expire, and must grant read access to this one object only.
     */
    Optional<TemporaryReadAccess> createTemporaryReadAccess(StorageKey key, Duration ttl) throws IOException;

}
