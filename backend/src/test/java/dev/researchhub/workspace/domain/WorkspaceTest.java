package dev.researchhub.workspace.domain;

import dev.researchhub.shared.validation.FieldLengths;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Workspace invariants, enforced by the domain rather than only by {@code CreateWorkspaceRequest}.
 *
 * <p>docs/development/validation.md requires exactly this: a DTO constraint gives a fast 400, and the
 * domain holds the same line for every caller that never passes through a controller.
 */
class WorkspaceTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");
    private static final UUID CREATOR = UUID.randomUUID();

    private static Workspace create(String name, String description) {
        return Workspace.create(name, description, CREATOR, NOW);
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

}
