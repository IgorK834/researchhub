package dev.researchhub.workspace.domain;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.validation.FieldLengths;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Workspace invariants, enforced by the domain rather than only by {@code CreateWorkspaceRequest} and
 * {@code UpdateWorkspaceRequest}.
 *
 * <p>docs/development/validation.md requires exactly this: a DTO constraint gives a fast 400, and the
 * domain holds the same line for every caller that never passes through a controller. The rename,
 * describe, and archive rules are tested here with no database and no HTTP, because they are rules about
 * what a legal change is — not about who is allowed to ask for one, which is
 * {@code WorkspaceAuthorizationService}'s job.
 */
class WorkspaceTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");
    private static final Instant LATER = Instant.parse("2026-09-24T09:00:00Z");
    private static final Instant MUCH_LATER = Instant.parse("2026-10-01T09:00:00Z");

    private static final UUID ID = UUID.randomUUID();
    private static final UUID CREATOR = UUID.randomUUID();
    private static final UUID ARCHIVER = UUID.randomUUID();

    private static Workspace create(String name, String description) {
        return Workspace.create(name, description, CREATOR, NOW);
    }

    /** A saved, active workspace: the state every change below starts from. */
    private static Workspace persisted() {
        return new Workspace(ID, "Electronics Lab", "Second-year measurements", CREATOR, NOW, NOW,
                null, null);
    }

    @Test
    void createsAWorkspaceThatIsNotPersistedYet() {
        Workspace workspace = create("Electronics Lab — Team 4", "Second-year measurements");

        assertNull(workspace.id(), "Hibernate assigns the id on insert");
        assertFalse(workspace.isPersisted());
        assertEquals(CREATOR, workspace.createdBy());
        assertEquals(NOW, workspace.createdAt());
        assertEquals(NOW, workspace.updatedAt(), "A new workspace has never been updated");
    }

    @Test
    void trimsTheName() {
        assertEquals("Electronics Lab", create("  Electronics Lab  ", null).name());
    }

    @Test
    void rejectsABlankName() {
        assertThrows(IllegalArgumentException.class, () -> create(null, null));
        assertThrows(IllegalArgumentException.class, () -> create("", null));
        assertThrows(IllegalArgumentException.class, () -> create("   ", null),
                "A whitespace-only name would be invisible in every list that renders it");
    }

    @Test
    void rejectsANameOverTheSharedLimit() {
        String longest = "n".repeat(FieldLengths.NAME_MAX);

        assertEquals(FieldLengths.NAME_MAX, create(longest, null).name().length(),
                "The documented maximum is accepted, and matches the workspaces.name column");
        assertThrows(IllegalArgumentException.class, () -> create(longest + "n", null));
    }

    @Test
    void treatsAnAbsentOrBlankDescriptionAsNoDescription() {
        assertNull(create("Lab", null).description());
        assertNull(create("Lab", "").description(),
                "Blank collapses to null so absent has one representation in the column and the API");
        assertNull(create("Lab", "   ").description());
    }

    @Test
    void trimsTheDescription() {
        assertEquals("Second-year measurements",
                create("Lab", "  Second-year measurements  ").description());
    }

    @Test
    void rejectsADescriptionOverTheSharedLimit() {
        String longest = "d".repeat(FieldLengths.DESCRIPTION_MAX);

        assertEquals(FieldLengths.DESCRIPTION_MAX, create("Lab", longest).description().length(),
                "The documented maximum is accepted, and matches the workspaces.description column");
        assertThrows(IllegalArgumentException.class, () -> create("Lab", longest + "d"));
    }

    @Test
    void requiresACreator() {
        assertThrows(NullPointerException.class,
                () -> Workspace.create("Lab", null, null, NOW),
                "A workspace with no creator could not be attributed or owned");
    }

    @Test
    void isActiveWhenCreated() {
        Workspace workspace = create("Lab", null);

        assertFalse(workspace.isArchived());
        assertNull(workspace.archivedAt());
        assertNull(workspace.archivedBy());
    }

    // --- renaming and describing ---

    @Test
    void renameReplacesTheNameAndMovesUpdatedAt() {
        Workspace renamed = persisted().rename("  Electronics Lab — Team 4  ", LATER);

        assertEquals("Electronics Lab — Team 4", renamed.name(), "The new name is trimmed too");
        assertEquals(LATER, renamed.updatedAt());
        assertEquals(NOW, renamed.createdAt(), "createdAt is history and does not move");
        assertEquals("Second-year measurements", renamed.description(),
                "Renaming leaves the description alone");
    }

    @Test
    void renameEnforcesTheSameNameRulesAsCreate() {
        Workspace workspace = persisted();

        assertThrows(IllegalArgumentException.class, () -> workspace.rename("   ", LATER),
                "A rename cannot do what a create is not allowed to do");
        assertThrows(IllegalArgumentException.class, () -> workspace.rename(null, LATER));
        assertThrows(IllegalArgumentException.class,
                () -> workspace.rename("n".repeat(FieldLengths.NAME_MAX + 1), LATER));
    }

    @Test
    void describeReplacesOrClearsTheDescription() {
        Workspace described = persisted().describe("  New notes  ", LATER);

        assertEquals("New notes", described.description());
        assertEquals(LATER, described.updatedAt());
        assertEquals("Electronics Lab", described.name(), "Describing leaves the name alone");

        assertNull(persisted().describe(null, LATER).description());
        assertNull(persisted().describe("   ", LATER).description(),
                "Blank clears the description, matching create");
    }

    @Test
    void describeEnforcesTheDescriptionLimit() {
        Workspace workspace = persisted();

        assertThrows(IllegalArgumentException.class,
                () -> workspace.describe("d".repeat(FieldLengths.DESCRIPTION_MAX + 1), LATER));
    }

    @Test
    void aChangeLeavesTheOriginalUntouched() {
        Workspace original = persisted();

        original.rename("Something else", LATER);

        assertEquals("Electronics Lab", original.name(),
                "A record cannot be mutated, so a caller decides and then persists what it was given");
        assertEquals(NOW, original.updatedAt());
    }

    // --- archiving ---

    @Test
    void archiveRecordsWhenAndByWhom() {
        Workspace archived = persisted().archive(ARCHIVER, LATER);

        assertTrue(archived.isArchived());
        assertEquals(LATER, archived.archivedAt());
        assertEquals(ARCHIVER, archived.archivedBy());
        assertEquals(LATER, archived.updatedAt(), "Archiving is a change, so updatedAt moves");
        assertEquals("Electronics Lab", archived.name(), "Archiving preserves the metadata");
        assertEquals("Second-year measurements", archived.description());
    }

    @Test
    void archiveIsIdempotentAndKeepsTheOriginalTimestamp() {
        Workspace archived = persisted().archive(ARCHIVER, LATER);

        Workspace archivedAgain = archived.archive(CREATOR, MUCH_LATER);

        assertEquals(LATER, archivedAgain.archivedAt(),
                "The column records when it actually happened, so a retry must not rewrite it");
        assertEquals(ARCHIVER, archivedAgain.archivedBy(), "nor who did it");
        assertEquals(archived, archivedAgain, "A second archive is a no-op");
    }

    @Test
    void archiveNeedsToKnowWhoAskedForIt() {
        assertThrows(NullPointerException.class, () -> persisted().archive(null, LATER));
    }

    @Test
    void anArchivedWorkspaceCannotBeRenamedOrDescribed() {
        Workspace archived = persisted().archive(ARCHIVER, LATER);

        ConflictException rename = assertThrows(ConflictException.class,
                () -> archived.rename("New name", MUCH_LATER),
                "Editing an archived workspace collides with its state");
        ConflictException describe = assertThrows(ConflictException.class,
                () -> archived.describe("New notes", MUCH_LATER));

        assertEquals(ApiErrorCode.CONFLICT, rename.code(),
                "CONFLICT, not FORBIDDEN: the caller may hold every capability there is");
        assertEquals(ApiErrorCode.CONFLICT, describe.code());
        assertTrue(rename.getMessage().contains("archived"),
                "The message should say why, but was: " + rename.getMessage());
    }

    @Test
    void rejectsHalfRecordedArchival() {
        assertThrows(IllegalArgumentException.class,
                () -> new Workspace(ID, "Lab", null, CREATOR, NOW, NOW, LATER, null),
                "An archived_at with no actor is a state no reader could interpret");
        assertThrows(IllegalArgumentException.class,
                () -> new Workspace(ID, "Lab", null, CREATOR, NOW, NOW, null, ARCHIVER),
                "and neither is an actor with no time");
    }

}
