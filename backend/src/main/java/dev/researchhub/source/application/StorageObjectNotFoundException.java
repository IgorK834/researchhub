package dev.researchhub.source.application;

import dev.researchhub.source.domain.StorageKey;

import java.io.IOException;

/**
 * Nothing is stored at a key the database says has bytes. For a recorded source that is an operational fault — the
 * object was removed behind the application's back — not something a caller did, so it is not mapped to a 404.
 */
public class StorageObjectNotFoundException extends IOException {

    public StorageObjectNotFoundException(StorageKey key) {
        super("No object is stored at " + key);
    }

}
