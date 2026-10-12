import { apiClient } from '../../../shared/api';
import { primeCsrfToken } from '../../auth/api/authApi';
export interface Invitation {
  readonly id: string;
  readonly email: string;
  readonly role: 'OWNER' | 'EDITOR' | 'VIEWER';
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
}
const path = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/invitations`;
export function listInvitations(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Invitation[]> {
  return apiClient.get(path(workspaceId), {
    ...(signal === undefined ? {} : { signal }),
  });
}
export async function createInvitation(
  workspaceId: string,
  email: string,
  role: Invitation['role'],
): Promise<{ invitation: Invitation; invitationPath: string }> {
  await primeCsrfToken();
  return apiClient.post(path(workspaceId), { body: { email, role } });
}
export async function revokeInvitation(workspaceId: string, id: string): Promise<void> {
  await primeCsrfToken();
  await apiClient.delete(`${path(workspaceId)}/${encodeURIComponent(id)}`);
}
export async function acceptInvitation(token: string): Promise<{ workspaceId: string }> {
  await primeCsrfToken();
  return apiClient.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
}
