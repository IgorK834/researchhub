package dev.researchhub.security.application;

import java.io.IOException;
import java.nio.file.Path;

/** Optional scanning port. Implementations must fail closed on rejection or scanner unavailability. */
public interface UploadScanner {
    void requireSafe(Path stagedFile) throws IOException;
}
