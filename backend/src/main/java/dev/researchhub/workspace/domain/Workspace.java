package dev.researchhub.workspace.domain;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A collaboration and security boundary (docs/context.md section 8).
 *
 * <p>Invariants enforced here, independently of {@code CreateWorkspaceRequest} and
 * {@code UpdateWorkspaceRequest}, because not every caller arrives through a validated controller
 * (docs/development/validation.md):
 *
 * <ul>
 *   <li>the name is present, trimmed, and within {@link FieldLengths#NAME_MAX},
 *   <li>the description is optional and within {@link FieldLengths#DESCRIPTION_MAX}, with blank
 *       normalized to {@code null} so "no description" has one representation,
 *   <li>{@code createdBy} is present,
 *   <li>{@code archivedAt} and {@code archivedBy} are either both absent or both present,
 *   <li>metadata cannot change while the workspace is archived.
 * </ul>
 *
 * <p>{@code createdBy} and {@code archivedBy} are bare {@link UUID}s rather than user objects. This
 * module must not import {@code user.domain} (docs/development/backend-architecture.md), and a workspace
 * does not need to know anything about those identities beyond which ones they were.
 *
 * <p>{@code id} is null for a workspace that has not been persisted yet: {@link #create} produces that
 * state and Hibernate assigns the identifier on insert, matching {@code User.register}.
 *
 * <p>Every change returns a new instance. A record cannot be mutated, so a caller decides and then
 * persists what it was given, and a rejected change leaves the original untouched.
 *
 * <p>Who may do what inside the workspace is <em>not</em> a property of this type. That is decided by
 * a membership, so it lives in {@link WorkspaceRole} and {@link WorkspaceMembers}. This type says what a
 * legal change <em>is</em>; the application layer says who is allowed to ask for one.
 */
public record Workspace(
        UUID id,
        String name,
        String description,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt,
        Instant archivedAt,
        UUID archivedBy
) {

    public Workspace {
        Objects.requireNonNull(createdBy, "createdBy must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");

        name = Normalize.trim(name);
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("workspace name must not be blank");
        }
        if (name.length() > FieldLengths.NAME_MAX) {
            throw new IllegalArgumentException(
                    "workspace name must be at most " + FieldLengths.NAME_MAX + " characters");
        }

        description = Normalize.trim(description);
        if (description != null) {
            if (description.isBlank()) {
                // A description is optional, so an empty string and NULL would mean the same thing.
                // Collapsing to NULL keeps one representation in the column and in the API response.
                description = null;
            } else if (description.length() > FieldLengths.DESCRIPTION_MAX) {
                throw new IllegalArgumentException(
                        "workspace description must be at most " + FieldLengths.DESCRIPTION_MAX
                                + " characters");
            }
        }

        // Mirrors ck_workspaces_archived_together. The two fields describe one event, so half of it is a
        // state no reader could interpret.
        if ((archivedAt == null) != (archivedBy == null)) {
            throw new IllegalArgumentException(
                    "archivedAt and archivedBy must either both be absent or both be present");
        }
    }

    /**
     * Creates an active workspace that has not been persisted yet.
     *
     * <p>{@code now} is passed in rather than read from a clock inside the domain, so timestamps are
     * deterministic in tests.
     *
     * @param createdBy the authenticated caller; never a client-supplied user id
     */
    public static Workspace create(String name, String description, UUID createdBy, Instant now) {
        return new Workspace(null, name, description, createdBy, now, now, null, null);
    }

    /** True once this workspace has a database identity. */
    public boolean isPersisted() {
        return id != null;
    }

    /** True when this workspace has been archived. */
    public boolean isArchived() {
        return archivedAt != null;
    }

    /**
     * Returns a copy carrying {@code newName}, with {@code updatedAt} moved to {@code now}.
     *
     * <p>The name rules are not re-implemented here: the canonical constructor runs on the copy, so a
     * blank or over-long name is rejected on rename exactly as it is on create.
     *
     * @throws IllegalArgumentException when the new name is blank or too long
     * @throws ConflictException        when the workspace is archived
     */
    public Workspace rename(String newName, Instant now) {
        requireActive("renamed");
        return new Workspace(id, newName, description, createdBy, createdAt, now, archivedAt, archivedBy);
    }

    /**
     * Returns a copy carrying {@code newDescription}, with {@code updatedAt} moved to {@code now}.
     *
     * <p>{@code null} or blank clears the description, which is the same normalization create performs.
     *
     * @throws IllegalArgumentException when the new description is too long
     * @throws ConflictException        when the workspace is archived
     */
    public Workspace describe(String newDescription, Instant now) {
        requireActive("changed");
        return new Workspace(id, name, newDescription, createdBy, createdAt, now, archivedAt, archivedBy);
    }

    /**
     * Returns an archived copy, or {@code this} when it is archived already.
     *
     * <p>Idempotent on purpose, and the original {@code archivedAt} wins: the column records when the
     * workspace actually left active use, so a second archive request — a double-clicked button, a
     * retried call — must not quietly rewrite that history. A caller can therefore treat archiving as
     * "make sure this is archived" and needs no check of its own.
     *
     * @param archivedBy the authenticated caller who asked for this
     */
    public Workspace archive(UUID archivedBy, Instant now) {
        Objects.requireNonNull(archivedBy, "archivedBy must not be null");
        if (isArchived()) {
            return this;
        }
        return new Workspace(id, name, description, createdBy, createdAt, now, now, archivedBy);
    }

    /**
     * Refuses a change on an archived workspace.
     *
     * <p>{@code CONFLICT} rather than {@code FORBIDDEN}: the caller may well hold every capability there
     * is, so the request is not an authorization failure. It collides with the workspace's current state,
     * which is what 409 means (docs/development/api-errors.md). The detail names no membership or
     * identity, so it is safe for any caller who got this far — and a non-member never does, because the
     * 404 check runs first.
     *
     * <p>Public because archiving freezes more than this record's own fields. Changing who belongs to the
     * workspace is refused by the same rule, and the membership code asks this type rather than repeating
     * the check — there is one definition of "archived means no more changes", and it lives with the state
     * it is about.
     *
     * @param change completes the sentence "This workspace is archived and cannot be …"
     */
    public void requireActive(String change) {
        if (isArchived()) {
            throw new ConflictException(
                    "This workspace is archived and cannot be " + change);
        }
    }

}
