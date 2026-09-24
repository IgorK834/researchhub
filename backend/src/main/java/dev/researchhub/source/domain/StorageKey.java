package dev.researchhub.source.domain;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Where a source's bytes are, relative to the storage adapter's container: {@code sources/<random uuid>}.
 *
 * <p>Opaque on purpose. It is generated here, from a random UUID, and contains nothing the user chose — not the file
 * name, which could otherwise become a path, and not the workspace or source id, which would invite somebody to
 * treat the key as meaning something. It is not a URL; turning it into one is the adapter's business.
 *
 * <p><strong>It carries no authority.</strong> Nothing looks a source up by its key, and no response exposes it.
 * Access is decided by the source row's workspace, found by id within the caller's workspace; the key is read from
 * that row only after the check has passed.
 */
public record StorageKey(String value) {

    private static final String PREFIX = "sources/";

    /** Mirrors {@code ck_sources_storage_key_format}. */
    private static final Pattern FORMAT = Pattern.compile(
            "^sources/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");

    public StorageKey {
        if (value == null || !FORMAT.matcher(value).matches()) {
            throw new IllegalArgumentException("not a storage key this application generated");
        }
    }

    /** A new, unused key. */
    public static StorageKey generate() {
        return new StorageKey(PREFIX + UUID.randomUUID());
    }

    @Override
    public String toString() {
        return value;
    }

}
