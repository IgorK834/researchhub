package dev.researchhub.source.application;

import java.net.URI;
import java.time.Instant;
import java.util.Objects;

/**
 * A pre-authorized, expiring URI that reads exactly one stored object. Produced by an adapter that supports it; the
 * application never builds one itself, and never stores one.
 */
public record TemporaryReadAccess(URI uri, Instant expiresAt) {

    public TemporaryReadAccess {
        Objects.requireNonNull(uri, "uri must not be null");
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
    }

}
