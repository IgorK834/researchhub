package dev.researchhub.workspace.domain;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The capability matrix from docs/context.md section 8, pinned down.
 *
 * <p>Plain unit tests: the rules are pure domain logic, so they need no database and no Spring context.
 * That is the point of keeping them in {@code workspace.domain} — the same rules apply to an HTTP
 * request, a background job, and a future member-management endpoint alike.
 */
class WorkspaceRoleTest {

    @Test
    void ownerMayManageMembersAndTheWorkspace() {
        assertTrue(WorkspaceRole.OWNER.allows(WorkspaceCapability.MANAGE_MEMBERS),
                "An owner manages members");
        assertTrue(WorkspaceRole.OWNER.allows(WorkspaceCapability.MANAGE_WORKSPACE),
                "An owner manages workspace metadata and eventually deletes or archives it");
        assertTrue(WorkspaceRole.OWNER.allows(WorkspaceCapability.EDIT_CONTENT),
                "An owner also edits content");
        assertTrue(WorkspaceRole.OWNER.allows(WorkspaceCapability.VIEW_CONTENT));
    }

    @Test
    void editorMayEditContentButNotManageMembers() {
        assertTrue(WorkspaceRole.EDITOR.allows(WorkspaceCapability.EDIT_CONTENT),
                "An editor creates and edits documents, uploads sources, and runs AI and analysis");
        assertFalse(WorkspaceRole.EDITOR.allows(WorkspaceCapability.MANAGE_MEMBERS),
                "Managing members is an owner's job");
        assertFalse(WorkspaceRole.EDITOR.allows(WorkspaceCapability.MANAGE_WORKSPACE),
                "An editor must not be able to delete or rename the workspace");
    }

    @Test
    void viewerMayOnlyRead() {
        assertTrue(WorkspaceRole.VIEWER.allows(WorkspaceCapability.VIEW_CONTENT),
                "A viewer reads documents, sources, and results");
        assertFalse(WorkspaceRole.VIEWER.allows(WorkspaceCapability.EDIT_CONTENT),
                "A viewer must not run a mutating operation on workspace content");
        assertFalse(WorkspaceRole.VIEWER.allows(WorkspaceCapability.MANAGE_MEMBERS));
        assertFalse(WorkspaceRole.VIEWER.allows(WorkspaceCapability.MANAGE_WORKSPACE));
    }

    @Test
    void everyRoleCanRead() {
        for (WorkspaceRole role : WorkspaceRole.values()) {
            assertTrue(role.allows(WorkspaceCapability.VIEW_CONTENT),
                    role + " is a member of the workspace, so it can read");
        }
    }

    @Test
    void onlyOwnerCanManage() {
        for (WorkspaceRole role : WorkspaceRole.values()) {
            boolean expected = role == WorkspaceRole.OWNER;
            assertTrue(expected == role.allows(WorkspaceCapability.MANAGE_MEMBERS),
                    "Member management is owner-only, but " + role + " disagreed");
            assertTrue(expected == role.allows(WorkspaceCapability.MANAGE_WORKSPACE),
                    "Workspace management is owner-only, but " + role + " disagreed");
        }
    }

    @Test
    void theCapabilitySetCannotBeWidenedByACaller() {
        assertThrows(UnsupportedOperationException.class,
                () -> WorkspaceRole.VIEWER.capabilities().add(WorkspaceCapability.EDIT_CONTENT),
                "A caller must not be able to grant itself a capability by mutating the role's set");
    }

}
