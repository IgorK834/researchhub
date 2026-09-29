import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  fetchSource,
  fetchSources,
  uploadSource,
  type WorkspaceSource,
} from './sourceApi';

export function useSourcesQuery(
  workspaceId: string,
): UseQueryResult<readonly WorkspaceSource[], Error> {
  return useQuery({
    queryKey: queryKeys.sources(workspaceId),
    queryFn: ({ signal }) => fetchSources(workspaceId, signal),
  });
}

export function useSourceQuery(
  workspaceId: string,
  sourceId: string,
): UseQueryResult<WorkspaceSource, Error> {
  return useQuery({
    queryKey: queryKeys.source(workspaceId, sourceId),
    queryFn: ({ signal }) => fetchSource(workspaceId, sourceId, signal),
  });
}

export interface UploadSourceInput {
  readonly file: File;
  readonly onProgress?: (loaded: number, total: number) => void;
}

export function useUploadSource(
  workspaceId: string,
): UseMutationResult<WorkspaceSource, ApiError, UploadSourceInput> {
  const queryClient = useQueryClient();
  return useMutation<WorkspaceSource, ApiError, UploadSourceInput>({
    mutationFn: ({ file, onProgress }) => uploadSource(workspaceId, file, onProgress),
    onSuccess: (source) => {
      queryClient.setQueryData(queryKeys.source(workspaceId, source.id), source);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
    },
  });
}
