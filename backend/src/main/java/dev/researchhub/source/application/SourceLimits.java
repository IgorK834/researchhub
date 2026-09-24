package dev.researchhub.source.application;

import dev.researchhub.source.domain.Source;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * How large one source may be. Configured by {@code researchhub.sources.max-size-bytes}.
 *
 * <p>Must be between 1 and {@link Source#MAX_SIZE_BYTES_CEILING}, the ceiling the {@code sources} table enforces.
 * A configured value above it would accept uploads the database then refuses, after the bytes were stored, so it
 * fails startup instead.
 *
 * <p>This is a per-source limit. How much a whole workspace may hold is {@link WorkspaceSourceQuota}.
 */
@Component
public class SourceLimits {

    private final long maxSourceBytes;

    public SourceLimits(@Value("${researchhub.sources.max-size-bytes:52428800}") long maxSourceBytes) {
        if (maxSourceBytes < 1 || maxSourceBytes > Source.MAX_SIZE_BYTES_CEILING) {
            throw new IllegalArgumentException("researchhub.sources.max-size-bytes must be between 1 and "
                    + Source.MAX_SIZE_BYTES_CEILING + ", was " + maxSourceBytes);
        }
        this.maxSourceBytes = maxSourceBytes;
    }

    public long maxSourceBytes() {
        return maxSourceBytes;
    }

    /** The limit for people: "50 MB", "1 GB", or a byte count when it is not a round number. */
    public String describe() {
        long megabyte = 1024L * 1024L;
        if (maxSourceBytes % (1024L * megabyte) == 0) {
            return maxSourceBytes / (1024L * megabyte) + " GB";
        }
        if (maxSourceBytes % megabyte == 0) {
            return maxSourceBytes / megabyte + " MB";
        }
        return maxSourceBytes + " bytes";
    }

}
