package dev.researchhub.workspace.domain;

/**
 * One thing a member may be allowed to do inside a workspace.
 *
 * <p>Authorization is expressed as capabilities rather than as role comparisons so a caller never has
 * to write {@code role == OWNER || role == EDITOR}. Such a check silently means "and any role added
 * later is denied", and it spreads the role table across every call site. A capability names the
 * requirement instead, and {@link WorkspaceRole} is the single place that maps roles to capabilities.
 *
 * <p>The set is deliberately small. It covers the actions the roles in docs/context.md section 8
 * distinguish, and nothing more; the document, source, and AI endpoints that will need
 * {@link #EDIT_CONTENT} do not exist yet.
 */
public enum WorkspaceCapability {

    /** Read workspace metadata, documents, sources, and results. Every member has this. */
    VIEW_CONTENT,

    /**
     * Create and edit documents, upload sources, run AI and analysis operations, and comment.
     *
     * <p>Every mutating operation on workspace-owned content requires this, which is what keeps a
     * VIEWER read-only.
     */
    EDIT_CONTENT,

    /** Add or remove members and change their roles. */
    MANAGE_MEMBERS,

    /** Change workspace metadata, and eventually archive or delete the workspace. */
    MANAGE_WORKSPACE

}
