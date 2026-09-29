package dev.researchhub.processing.application;

import java.net.URI;
import java.time.Instant;
import java.util.Objects;

/** Trusted source facts and one short-lived read capability resolved by Spring from its own database. */
public record SourceIngestInput(String sourceType, URI signedReadUrl, Instant expiresAt) {

    public SourceIngestInput {
        sourceType = Objects.requireNonNull(sourceType, "sourceType");
        signedReadUrl = Objects.requireNonNull(signedReadUrl, "signedReadUrl");
        expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
        if (!signedReadUrl.isAbsolute()
                || !("http".equals(signedReadUrl.getScheme()) || "https".equals(signedReadUrl.getScheme()))) {
            throw new IllegalArgumentException("source access URL must be absolute HTTP(S)");
        }
    }
}
