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
}

export interface CreateWorkspaceInput {
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
