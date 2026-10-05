package dev.researchhub.document.application;

import java.util.UUID;

/** Extension point for an alternate authoring transport; called while the document row is locked. */
public interface DocumentWriteGuard {
    void requireLegacyWrite(UUID documentId);
}
