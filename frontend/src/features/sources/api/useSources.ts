import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import { fetchSources, uploadSource, type WorkspaceSource } from './sourceApi';

export function useSourcesQuery(
  workspaceId: string,
): UseQueryResult<readonly WorkspaceSource[], Error> {
  return useQuery({
    queryKey: queryKeys.sources(workspaceId),
    queryFn: ({ signal }) => fetchSources(workspaceId, signal),
  });
}

export function useUploadSource(
  workspaceId: string,
): UseMutationResult<WorkspaceSource, ApiError, File> {
  const queryClient = useQueryClient();
  return useMutation<WorkspaceSource, ApiError, File>({
    mutationFn: (file) => uploadSource(workspaceId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
    },
  });
}
