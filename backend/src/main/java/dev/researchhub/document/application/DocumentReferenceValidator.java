package dev.researchhub.document.application;

import java.util.UUID;

/** Modules validate their semantic nodes before a document revision is stored. */
public interface DocumentReferenceValidator {
    void validate(UUID workspaceId, UUID callerId, String content);
}
