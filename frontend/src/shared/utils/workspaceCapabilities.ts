export interface WorkspaceCapabilities {
  readonly canRead: boolean;
  readonly canEditContent: boolean;
  readonly canManage: boolean;
}

/** UI affordances for an already server-authorized membership; never an authorization guard. */
export function workspaceCapabilities(
  role: string | undefined,
  archived: boolean,
): WorkspaceCapabilities {
  return {
    // An unfamiliar server-provided membership still renders readable content.
    canRead: role !== undefined && role.trim().length > 0,
    canEditContent: !archived && (role === 'OWNER' || role === 'EDITOR'),
    canManage: !archived && role === 'OWNER',
  };
}

/** Known roles have design labels; future role strings remain visible verbatim. */
export function workspaceRoleLabel(role: string): string {
  switch (role) {
    case 'OWNER':
      return 'Owner';
    case 'EDITOR':
      return 'Editor';
    case 'VIEWER':
      return 'Viewer';
    default:
      return role.trim() ? role : 'Unknown role';
  }
}
