package dev.researchhub.document.domain;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A piece of authored content belonging to exactly one workspace.
 *
 * <p>Invariants enforced here, independently of any request DTO, because not every caller arrives through a
 * validated controller (docs/development/validation.md):
 *
 * <ul>
 *   <li>the workspace is present — a document with no workspace would be a document with no access rule,
 *   <li>the title is present, trimmed, and within {@link FieldLengths#TITLE_MAX},
 *   <li>the content is present and within its size bound ({@link DocumentContent}),
 *   <li>the revision starts at 1 and only ever increases,
 *   <li>an archived document accepts no further revisions.
 * </ul>
 *
 * <p>{@code workspaceId} and {@code createdBy} are bare {@link UUID}s. This module must not import
 * {@code workspace.domain} or {@code user.domain} (docs/development/backend-architecture.md), and a document
 * does not need to know anything about either beyond which one it belongs to and who wrote it. Who may read
 * or edit it is decided by the caller's membership of that workspace, which is
 * {@code WorkspaceAuthorizationService}'s job, not this type's.
 *
 * <p><strong>{@code revision} is part of the contract, not a persistence detail.</strong> A client reads it
 * and sends it back, and {@link #revise} refuses a stale one. That is deliberately not a Hibernate
 * {@code @Version} the API hides: two people editing the same paragraph is a product problem with a product
 * answer — tell the second one — and hiding the token would leave the API with no way to say it. Realtime
 * merging is a later concern (docs/context.md section 9); this is the honest single-writer version of it.
 *
 * <p>Every change returns a new instance, so a rejected one leaves the original untouched.
 */
public record Document(
        UUID id,
        UUID workspaceId,
        String title,
        DocumentContent content,
        DocumentContentFormat contentFormat,
        long revision,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt
) {

    /** The revision every document starts at. */
    public static final long FIRST_REVISION = 1L;

    public Document {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(content, "content must not be null");
        Objects.requireNonNull(contentFormat, "contentFormat must not be null");
        Objects.requireNonNull(createdBy, "createdBy must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");

        title = Normalize.trim(title);
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("document title must not be blank");
        }
        if (title.length() > FieldLengths.TITLE_MAX) {
            throw new IllegalArgumentException(
                    "document title must be at most " + FieldLengths.TITLE_MAX + " characters");
        }

        if (revision < FIRST_REVISION) {
            throw new IllegalArgumentException("document revision must be at least " + FIRST_REVISION);
        }
    }

    /**
     * Creates a document that has not been persisted yet, at {@link #FIRST_REVISION}.
     *
     * <p>{@code now} is passed in rather than read from a clock inside the domain, so timestamps are
     * deterministic in tests.
     *
     * @param createdBy the authenticated caller; never a client-supplied user id
     */
    public static Document create(UUID workspaceId, String title, DocumentContent content,
                                  UUID createdBy, Instant now) {
        return new Document(null, workspaceId, title, content, DocumentContentFormat.PROSEMIRROR_JSON,
                FIRST_REVISION, createdBy, now, now, null);
    }

    /** True once this document has a database identity. */
    public boolean isPersisted() {
        return id != null;
    }

    /** True when this document has been archived. */
    public boolean isArchived() {
        return archivedAt != null;
    }

    /**
     * Returns the next revision of this document, with {@code updatedAt} moved to {@code now}.
     *
     * <p>{@code expectedRevision} is what the editor last saw. If the stored revision has moved on, somebody
     * else saved in between and this write is refused rather than applied — overwriting them silently is the
     * one outcome nobody can recover from, because the text they wrote would be gone with no record that it
     * existed.
     *
     * <p>{@code CONFLICT} rather than a validation failure: the request is well formed and the caller is
     * allowed to make it. It collides with the document's current state, which is what 409 means
     * (docs/development/api-errors.md).
     *
     * @throws ConflictException        when {@code expectedRevision} is stale, or the document is archived
     * @throws IllegalArgumentException when the new title or content breaks a rule
     */
    public Document revise(String newTitle, DocumentContent newContent, long expectedRevision,
                           Instant now) {
        if (isArchived()) {
            throw new ConflictException("This document is archived and cannot be changed");
        }
        if (expectedRevision != revision) {
            throw new ConflictException("This document was changed by somebody else. It is now at revision "
                    + revision + ", and your copy is at revision " + expectedRevision
                    + ". Reload it and apply your changes again.");
        }

        return new Document(id, workspaceId, newTitle, newContent, contentFormat, revision + 1,
                createdBy, createdAt, now, archivedAt);
    }

    /**
     * Returns an archived copy, or {@code this} when it is archived already.
     *
     * <p>Idempotent, and the original {@code archivedAt} wins, for the same reason a workspace's does: the
     * column records when the document actually left use, so a retried request must not rewrite it. The
     * content is untouched — archiving a document hides it from the list, it does not destroy the text.
     */
    public Document archive(Instant now) {
        if (isArchived()) {
            return this;
        }
        return new Document(id, workspaceId, title, content, contentFormat, revision, createdBy,
                createdAt, now, now);
    }

}
