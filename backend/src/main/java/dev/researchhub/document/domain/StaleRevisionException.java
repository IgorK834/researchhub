package dev.researchhub.document.domain;

import dev.researchhub.shared.error.ConflictException;

import java.util.Map;

/**
 * A save based on a revision that is no longer the stored one: somebody else saved in between.
 *
 * <p>Still {@code 409 CONFLICT}, with the same kind of human-readable detail as before. What it adds is
 * {@value #CURRENT_REVISION_PROPERTY} in the ProblemDetail body, so a client can say which revision it is behind
 * without parsing the sentence. It does not carry the stored content — the client reloads that with the ordinary
 * {@code GET} when the user asks, and an error body is the wrong place to ship somebody's prose.
 *
 * <p>Only this conflict carries the property. An archived document or workspace is also {@code 409}, but it is
 * not a newer revision of the same edit, and reloading would not let the save succeed.
 */
public class StaleRevisionException extends ConflictException {

    /** The ProblemDetail member that carries {@link #currentRevision()}. Documented in api-errors.md. */
    public static final String CURRENT_REVISION_PROPERTY = "currentRevision";

    private final long currentRevision;

    public StaleRevisionException(long currentRevision, long expectedRevision) {
        super("This document was changed by somebody else. It is now at revision " + currentRevision
                        + ", and your copy is at revision " + expectedRevision
                        + ". Reload it and apply your changes again.",
                Map.of(CURRENT_REVISION_PROPERTY, currentRevision));
        this.currentRevision = currentRevision;
    }

    /** The revision that is stored now, which the refused save did not change. */
    public long currentRevision() {
        return currentRevision;
    }

}
