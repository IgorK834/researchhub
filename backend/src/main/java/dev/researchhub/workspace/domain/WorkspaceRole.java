package dev.researchhub.workspace.domain;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

/**
 * What a member is allowed to do in one workspace. The roles are the ones named in docs/context.md
 * section 8.
 *
 * <p>This enum is the whole authorization table for a workspace, and it lives in {@code domain} on
 * purpose: the rule has to hold for every caller, not only for one that arrived through a controller
 * (docs/development/validation.md). It is not in {@code shared}, because workspace roles are a product
 * concept owned by this module (docs/development/backend-architecture.md), and it is not in React,
 * because a hidden button is not access control.
 *
 * <table>
 *   <caption>Capability matrix</caption>
 *   <tr><th></th><th>VIEW_CONTENT</th><th>EDIT_CONTENT</th><th>USE_AI</th><th>MANAGE_MEMBERS</th><th>MANAGE_WORKSPACE</th></tr>
 *   <tr><td>OWNER</td> <td>yes</td><td>yes</td><td>yes</td><td>yes</td><td>yes</td></tr>
 *   <tr><td>EDITOR</td><td>yes</td><td>yes</td><td>yes</td><td>no</td> <td>no</td></tr>
 *   <tr><td>VIEWER</td><td>yes</td><td>no</td> <td>no</td> <td>no</td> <td>no</td></tr>
 * </table>
 *
 * <p>Adding a value here also means widening {@code ck_workspace_members_role} in a new migration,
 * the same way {@code UserStatus} is pinned by {@code ck_users_status}.
 */
public enum WorkspaceRole {

    /**
     * Manages workspace metadata and members, edits content, and eventually archives or deletes the
     * workspace. A workspace always keeps at least one owner; see {@link WorkspaceMembers}.
     */
    OWNER(EnumSet.allOf(WorkspaceCapability.class)),

    /** Creates and edits content. Cannot manage members or the workspace itself. */
    EDITOR(EnumSet.of(WorkspaceCapability.VIEW_CONTENT, WorkspaceCapability.EDIT_CONTENT, WorkspaceCapability.USE_AI)),

    /** Reads content. Cannot run any mutating operation. */
    VIEWER(EnumSet.of(WorkspaceCapability.VIEW_CONTENT));

    private final Set<WorkspaceCapability> capabilities;

    WorkspaceRole(Set<WorkspaceCapability> capabilities) {
        this.capabilities = Collections.unmodifiableSet(capabilities);
    }

    /** True when this role carries {@code capability}. */
    public boolean allows(WorkspaceCapability capability) {
        return capabilities.contains(capability);
    }

    /** Unmodifiable view of everything this role may do. */
    public Set<WorkspaceCapability> capabilities() {
        return capabilities;
    }

}
