import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  archiveWorkspace,
  createWorkspace,
  fetchWorkspace,
  fetchWorkspaces,
  updateWorkspace,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type Workspace,
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
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
export function useWorkspaceQuery(workspaceId: string): UseQueryResult<Workspace, Error> {
  return useQuery({
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
