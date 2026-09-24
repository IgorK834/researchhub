package dev.researchhub.source.application;

import java.io.InputStream;
import java.util.Objects;

/**
 * One file to add to a workspace.
 *
 * @param originalFilename  the name the client gave the file; cleaned into metadata, never used as a path
 * @param declaredMediaType the client's {@code Content-Type} for the file, or {@code null}; checked, never stored
 * @param declaredSizeBytes the size the client announced, or {@code null}; used only to refuse early, since the
 *                          stream is metered regardless
 * @param content           the bytes, read once and not closed by the service
 */
public record UploadSourceCommand(
        String originalFilename,
        String declaredMediaType,
        Long declaredSizeBytes,
        InputStream content
) {

    public UploadSourceCommand {
        Objects.requireNonNull(content, "content must not be null");
    }

}
