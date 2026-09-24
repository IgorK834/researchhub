import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';

/**
 * Transport for the workspace endpoints. Everything goes through the shared client, so the credentials
 * mode, CSRF header, and ProblemDetail decoding are the same as everywhere else — see
 * docs/development/frontend-api.md.
 */

const WORKSPACES_PATH = '/api/workspaces';

/**
 * A workspace as the backend returns it. Mirrors `WorkspaceResponse`.
 *
 * `role` is the role **the signed-in user** holds here, so it differs between two people looking at the
 * same workspace. It is typed as a plain string rather than a union of the three known roles: a role
 * added on the server should render as an unfamiliar label, not break decoding.
 *
 * Nothing about any user appears on this type. The list endpoint returns no member's email or name, and
 * identity is read from `GET /api/me` instead.
 */
export interface Workspace {
  readonly id: string;
  readonly name: string;
  /** `null` when the workspace has no description. The backend stores blank as absent. */
  readonly description: string | null;
  readonly role: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * `null` while the workspace is active, a timestamp once it has been archived.
   *
   * An archived workspace never appears in `fetchWorkspaces`, so this is only ever non-null on a
   * workspace fetched by id. There is no `archivedBy`: who archived it is recorded server-side for audit
   * and is not part of the response.
   */
  readonly archivedAt: string | null;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly description: string;
}

/**
 * Both metadata fields, because `PATCH /api/workspaces/{id}` replaces them rather than merging whichever
 * ones are present. An edit form is populated from the current values, so it has both to send.
 */
export interface UpdateWorkspaceInput {
  readonly name: string;
  readonly description: string;
}

/**
 * The workspaces the signed-in user belongs to, newest first.
 *
 * Scoping happens on the server, from the caller's memberships. There is no query parameter to widen
 * it and no endpoint that returns anyone else's workspaces.
 */
export function fetchWorkspaces(signal?: AbortSignal): Promise<readonly Workspace[]> {
  return apiClient.get<readonly Workspace[]>(WORKSPACES_PATH, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * One member of a workspace. Mirrors `WorkspaceMemberResponse`.
 *
 * Four fields, and no others exist on the server side either: no password, no hash, no
 * `normalizedEmail`, and no account status. `userId` is the key the role and removal calls take.
 */
export interface WorkspaceMember {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
}

/**
 * A new member joins as an editor or a viewer.
 *
 * `OWNER` is absent on purpose, and the server refuses it too: ownership is granted to somebody who is
 * already a member, through `changeWorkspaceMemberRole`.
 */
export interface AddWorkspaceMemberInput {
  readonly email: string;
  readonly role: 'EDITOR' | 'VIEWER';
}

/**
 * Everyone in the workspace.
 *
 * Readable by any member, including a viewer and including on an archived workspace — knowing who you
 * work with is not a privilege. A non-member gets `RESOURCE_NOT_FOUND`, the same answer the workspace
 * itself gives them.
 */
export function fetchWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<readonly WorkspaceMember[]> {
  return apiClient.get<readonly WorkspaceMember[]>(
    `${WORKSPACES_PATH}/${workspaceId}/members`,
    {
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

/**
 * Adds a registered user by their exact email address.
 *
 * Nothing is sent to the address. An address with no active account is `RESOURCE_NOT_FOUND` with one
 * stable detail, which the UI shows as-is — there is no invitation to offer, and no way to find out
 * whether the address is registered from anywhere else either. Somebody who is already a member is
 * `CONFLICT`.
 */
export async function addWorkspaceMember(
  workspaceId: string,
  input: AddWorkspaceMemberInput,
): Promise<WorkspaceMember> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<WorkspaceMember>(`${WORKSPACES_PATH}/${workspaceId}/members`, {
    body: input,
  });
}

/**
 * Changes one member's role. Owners only, decided by the server.
 *
 * Demoting the last owner is `CONFLICT`: promote somebody else first. Promoting a member to `OWNER`
 * leaves the existing owner in place, so a transfer is a promotion followed by a demotion.
 */
export async function changeWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<WorkspaceMember> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.patch<WorkspaceMember>(
    `${WORKSPACES_PATH}/${workspaceId}/members/${userId}`,
    { body: { role } },
  );
}

/**
 * Removes one member's access. Owners only, decided by the server.
 *
 * Deletes one membership and nothing else: the account survives, and so does everything recording what
 * that person did. Removing the last owner is `CONFLICT`.
 */
export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  await apiClient.delete<void>(`${WORKSPACES_PATH}/${workspaceId}/members/${userId}`);
}

/**
 * Creates a workspace. The caller becomes its owner.
 *
 * There is no creator field in the body: the backend takes the owner from the session. Sending one
 * would be ignored.
 *
 * The CSRF cookie is primed first, exactly as the auth calls do. The cookie normally already exists by
 * the time anyone reaches this screen, but it is the one thing a mutating request cannot do without, and
 * no GET restores it — so a cheap 204 here is better than a 403 the user can only escape by reloading.
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<Workspace>(WORKSPACES_PATH, { body: input });
}

/**
 * One workspace, including the caller's role in it.
 *
 * Throws `ApiError` with code `RESOURCE_NOT_FOUND` both when no such workspace exists and when the caller
 * is not a member. The server answers those two identically on purpose, so a client cannot use this
 * endpoint to discover that someone else's workspace exists — and the UI must not try to tell them apart
 * either.
 *
 * Unlike the list, this still returns an archived workspace to its members, with `archivedAt` set.
 */
export function fetchWorkspace(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Workspace> {
  return apiClient.get<Workspace>(`${WORKSPACES_PATH}/${workspaceId}`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Changes a workspace's name and description. Owners only, decided by the server.
 *
 * A caller whose role is too low gets `403 FORBIDDEN`, and editing an archived workspace gets
 * `409 CONFLICT`. Hiding the form for a non-owner is a courtesy, not the control.
 */
export async function updateWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.patch<Workspace>(`${WORKSPACES_PATH}/${workspaceId}`, { body: input });
}

/**
 * Archives a workspace. Owners only, decided by the server.
 *
 * Soft: nothing is deleted, no member loses their membership, and the workspace stays readable by id. It
 * simply leaves `fetchWorkspaces`. Idempotent — archiving twice returns the same state with the original
 * timestamp — so a retried request is harmless.
 */
export async function archiveWorkspace(workspaceId: string): Promise<Workspace> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<Workspace>(`${WORKSPACES_PATH}/${workspaceId}/archive`);
}
