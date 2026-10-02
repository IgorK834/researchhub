import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  addWorkspaceMember,
  archiveWorkspace,
  changeWorkspaceMemberRole,
  createWorkspace,
  fetchWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaces,
  removeWorkspaceMember,
  updateWorkspace,
  type AddWorkspaceMemberInput,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
  type WorkspaceMember,
} from './workspaceApi';

/**
 * The signed-in user's workspaces.
 *
 * Cached under `queryKeys.workspaces()`, the shared factory's key for this collection, so a mutation
 * elsewhere can invalidate it by prefix without knowing about this hook.
 *
 * A 401 is not handled here. `RequireAuthenticatedUser` has already resolved the session before any
 * `/app` route mounts, and `useLogout` clears the whole cache on the way out, so there is no state in
 * which this query is the thing that discovers the user is signed out.
 */
export function useWorkspacesQuery(): UseQueryResult<readonly Workspace[], Error> {
  return useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: ({ signal }) => fetchWorkspaces(signal),
  });
}

/**
 * Creates a workspace and refreshes the list.
 *
 * Invalidates only `['workspaces']`. That is the narrowest key covering what a create actually changed:
 * the collection gained a member, while no individual workspace's data changed. A blanket
 * `invalidateQueries()` would turn one save into a refetch of everything cached.
 */
export function useCreateWorkspace(): UseMutationResult<
  Workspace,
  ApiError,
  CreateWorkspaceInput
> {
  const queryClient = useQueryClient();

  return useMutation<Workspace, ApiError, CreateWorkspaceInput>({
    mutationFn: (input) => createWorkspace(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
    },
  });
}

/**
 * One workspace, cached under `queryKeys.workspace(id)`.
 *
 * A sibling of the list key rather than a slice of it: `['workspaces', id]` sits under `['workspaces']`,
 * so invalidating the collection also refreshes any open workspace, while invalidating one workspace
 * leaves the others cached.
 *
 * A 404 is left as an error for the page to recognise. It is not mapped to `null` the way an
 * unauthenticated current user is, because "not found" here is a dead end the page has to render
 * differently, not an ordinary value.
 */
export function useWorkspaceQuery(
  workspaceId: string,
  enabled = true,
): UseQueryResult<Workspace, Error> {
  return useQuery({
    enabled,
    queryKey: queryKeys.workspace(workspaceId),
    queryFn: ({ signal }) => fetchWorkspace(workspaceId, signal),
  });
}

/**
 * Updates a workspace's metadata.
 *
 * Writes the response into `queryKeys.workspace(id)` so the page it came from renders the saved values
 * without a second request, and invalidates `queryKeys.workspaces()` because the name shown in the list
 * has changed. Two keys, both of which the write really did affect.
 */
export function useUpdateWorkspace(
  workspaceId: string,
): UseMutationResult<Workspace, ApiError, UpdateWorkspaceInput> {
  const queryClient = useQueryClient();

  return useMutation<Workspace, ApiError, UpdateWorkspaceInput>({
    mutationFn: (input) => updateWorkspace(workspaceId, input),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.workspace(workspaceId), workspace);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
    },
  });
}

/**
 * Archives a workspace.
 *
 * Invalidates the list, which is where the effect is visible: an archived workspace drops out of it. The
 * detail cache is updated too, so if the user navigates back to the workspace it already reads as
 * archived rather than briefly showing an editable, active one.
 */
export function useArchiveWorkspace(
  workspaceId: string,
): UseMutationResult<Workspace, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<Workspace, ApiError, void>({
    mutationFn: () => archiveWorkspace(workspaceId),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.workspace(workspaceId), workspace);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
    },
  });
}

/**
 * Everyone in the workspace, for any member to see.
 *
 * Keyed under the workspace, so `queryKeys.workspaces()` invalidation reaches it by prefix.
 */
export function useWorkspaceMembersQuery(
  workspaceId: string,
  enabled = true,
): UseQueryResult<readonly WorkspaceMember[], Error> {
  return useQuery({
    enabled,
    queryKey: queryKeys.workspaceMembers(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceMembers(workspaceId, signal),
  });
}

/**
 * Invalidates everything a membership change can affect.
 *
 * One call, because `['workspaces']` is a prefix of both `['workspaces', id]` and
 * `['workspaces', id, 'members']`, so it covers the roster and the workspace as well as the collection.
 * The collection really is in scope: an owner who removes their own membership should stop seeing the
 * workspace in their list.
 *
 * What this cannot do is update anyone else's browser. The person who was just added, promoted, or
 * removed sees the change on their next fetch, not because this ran.
 */
function useMembershipInvalidation(): () => void {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
  };
}

/** Adds a registered user as an editor or viewer, then refreshes the roster. */
export function useAddWorkspaceMember(
  workspaceId: string,
): UseMutationResult<WorkspaceMember, ApiError, AddWorkspaceMemberInput> {
  const invalidate = useMembershipInvalidation();

  return useMutation<WorkspaceMember, ApiError, AddWorkspaceMemberInput>({
    mutationFn: (input) => addWorkspaceMember(workspaceId, input),
    onSuccess: invalidate,
  });
}

export interface ChangeMemberRoleInput {
  readonly userId: string;
  readonly role: string;
}

/**
 * Changes one member's role.
 *
 * The role is sent as the server's own vocabulary rather than a client-side union, so an unfamiliar role
 * returned by a newer backend can still be echoed back unchanged instead of being silently narrowed.
 */
export function useChangeWorkspaceMemberRole(
  workspaceId: string,
): UseMutationResult<WorkspaceMember, ApiError, ChangeMemberRoleInput> {
  const invalidate = useMembershipInvalidation();

  return useMutation<WorkspaceMember, ApiError, ChangeMemberRoleInput>({
    mutationFn: ({ userId, role }) =>
      changeWorkspaceMemberRole(workspaceId, userId, role),
    onSuccess: invalidate,
  });
}

/** Removes one member's access. */
export function useRemoveWorkspaceMember(
  workspaceId: string,
): UseMutationResult<void, ApiError, string> {
  const invalidate = useMembershipInvalidation();

  return useMutation<void, ApiError, string>({
    mutationFn: (userId) => removeWorkspaceMember(workspaceId, userId),
    onSuccess: invalidate,
  });
}
