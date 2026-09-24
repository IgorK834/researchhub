package dev.researchhub.source.application;

import java.io.IOException;

/**
 * Thrown from {@link MeteredInputStream#read} once more than the limit has been read. An {@link IOException} so it
 * passes unchanged through any adapter's copy loop, which is how the limit reaches every adapter without each one
 * implementing it.
 */
public class ContentLimitExceededException extends IOException {

    private final long limitBytes;

    public ContentLimitExceededException(long limitBytes) {
        super("The content is larger than " + limitBytes + " bytes");
        this.limitBytes = limitBytes;
    }

    public long limitBytes() {
        return limitBytes;
    }

}
