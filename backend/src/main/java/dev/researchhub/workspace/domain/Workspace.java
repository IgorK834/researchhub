package dev.researchhub.workspace.domain;

import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.shared.validation.Normalize;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A collaboration and security boundary (docs/context.md section 8).
 *
 * <p>Invariants enforced here, independently of {@code CreateWorkspaceRequest}, because not every
 * caller arrives through a validated controller (docs/development/validation.md):
 *
 * <ul>
 *   <li>the name is present, trimmed, and within {@link FieldLengths#NAME_MAX},
 *   <li>the description is optional and within {@link FieldLengths#DESCRIPTION_MAX}, with blank
 *       normalized to {@code null} so "no description" has one representation,
 *   <li>{@code createdBy} is present.
 * </ul>
 *
 * <p>{@code createdBy} is a bare {@link UUID} rather than a user object. This module must not import
 * {@code user.domain} (docs/development/backend-architecture.md), and a workspace does not need to
 * know anything about its creator beyond which identity it was.
 *
 * <p>{@code id} is null for a workspace that has not been persisted yet: {@link #create} produces that
 * state and Hibernate assigns the identifier on insert, matching {@code User.register}.
 *
 * <p>Who may do what inside the workspace is <em>not</em> a property of this type. That is decided by
 * a membership, so it lives in {@link WorkspaceRole} and {@link WorkspaceMembers}.
 */
public record Workspace(
        UUID id,
        String name,
        String description,
        UUID createdBy,
        Instant createdAt,
        Instant updatedAt
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
    }

    /**
     * Creates a workspace that has not been persisted yet.
     *
     * <p>{@code now} is passed in rather than read from a clock inside the domain, so timestamps are
     * deterministic in tests.
     *
     * @param createdBy the authenticated caller; never a client-supplied user id
     */
    public static Workspace create(String name, String description, UUID createdBy, Instant now) {
        return new Workspace(null, name, description, createdBy, now, now);
    }

    /** True once this workspace has a database identity. */
    public boolean isPersisted() {
        return id != null;
    }

}
