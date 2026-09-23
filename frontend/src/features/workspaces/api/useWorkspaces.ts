import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  createWorkspace,
  fetchWorkspaces,
  type CreateWorkspaceInput,
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
