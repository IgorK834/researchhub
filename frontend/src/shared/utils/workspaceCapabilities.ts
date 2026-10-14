import { t as uiText } from '../i18n';
export interface WorkspaceCapabilities {
  readonly canRead: boolean;
  readonly canEditContent: boolean;
  readonly canManage: boolean;
  readonly canViewSettings: boolean;
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
    canViewSettings: role === 'OWNER' || role === 'EDITOR',
  };
}

/** Known roles have design labels; future role strings remain visible verbatim. */
export function workspaceRoleLabel(role: string): string {
  switch (role) {
    case 'OWNER':
      return uiText('ui.InvitationPanel.message005');
    case 'EDITOR':
      return uiText('ui.AddMemberForm.message003');
    case 'VIEWER':
      return uiText('ui.AddMemberForm.message004');
    default:
      return role.trim() ? role : uiText('ui.workspaceCapabilities.message001');
  }
}
