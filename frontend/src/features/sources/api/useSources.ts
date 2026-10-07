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
  searchSources,
  fetchSourceFacets,
  saveSourceBibliography,
  saveSourceOrganization,
  type SourceFilters,
  type SourceBibliography,
  type SourceOrganization,
  reprocessSource,
  fetchSources,
  fetchSourceVersions,
  uploadSource,
  replaceSource,
  type SourceVersion,
  type WorkspaceSource,
} from './sourceApi';

export function useSourcesQuery(
  workspaceId: string,
  enabled = true,
): UseQueryResult<readonly WorkspaceSource[], Error> {
  return useQuery({
    enabled,
    queryKey: queryKeys.sources(workspaceId),
    queryFn: ({ signal }) => fetchSources(workspaceId, signal),
    refetchInterval: (query) =>
      query.state.data?.some(
        (source) => source.status === 'UPLOADED' || source.status === 'PROCESSING',
      )
        ? 2000
        : false,
  });
}

export function useSourceQuery(
  workspaceId: string,
  sourceId: string,
): UseQueryResult<WorkspaceSource, Error> {
  return useQuery({
    queryKey: queryKeys.source(workspaceId, sourceId),
    queryFn: ({ signal }) => fetchSource(workspaceId, sourceId, signal),
    refetchInterval: (query) =>
      query.state.data?.status === 'UPLOADED' || query.state.data?.status === 'PROCESSING'
        ? 2000
        : false,
  });
}

/** Every immutable upload of one source, newest first. */
export function useSourceVersionsQuery(
  workspaceId: string,
  sourceId: string,
): UseQueryResult<readonly SourceVersion[], Error> {
  return useQuery({
    queryKey: queryKeys.sourceVersions(workspaceId, sourceId),
    queryFn: ({ signal }) => fetchSourceVersions(workspaceId, sourceId, signal),
    refetchInterval: (query) =>
      query.state.data?.some(
        (version) => version.status === 'UPLOADED' || version.status === 'PROCESSING',
      )
        ? 2000
        : false,
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

export function useReprocessSource(
  workspaceId: string,
  sourceId: string,
): UseMutationResult<WorkspaceSource, ApiError, void> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => reprocessSource(workspaceId, sourceId),
    onSuccess: (source) => {
      client.setQueryData(queryKeys.source(workspaceId, sourceId), source);
      void client.invalidateQueries({
        queryKey: queryKeys.sourceExtraction(workspaceId, sourceId),
        refetchType: 'none',
      });
      void client.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
    },
  });
}

export function useReplaceSource(
  workspaceId: string,
  sourceId: string,
): UseMutationResult<WorkspaceSource, ApiError, UploadSourceInput> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }) =>
      replaceSource(workspaceId, sourceId, file, onProgress),
    onSuccess: (source) => {
      client.setQueryData(queryKeys.source(workspaceId, sourceId), source);
      void client.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
      void client.invalidateQueries({
        queryKey: queryKeys.sourceVersions(workspaceId, sourceId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.datasetPreview(workspaceId, sourceId),
      });
    },
  });
}

export function useSourceSearchQuery(workspaceId: string, filters: SourceFilters) {
  return useQuery({
    queryKey: [...queryKeys.sources(workspaceId), 'search', filters],
    queryFn: ({ signal }) => searchSources(workspaceId, filters, signal),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (source) => source.status === 'UPLOADED' || source.status === 'PROCESSING',
      )
        ? 2000
        : false,
  });
}
export function useSourceFacetsQuery(workspaceId: string) {
  return useQuery({
    queryKey: [...queryKeys.sources(workspaceId), 'facets'],
    queryFn: ({ signal }) => fetchSourceFacets(workspaceId, signal),
    refetchInterval: 2000,
  });
}
export function useSaveSourceDetails(workspaceId: string, sourceId: string) {
  const client = useQueryClient();
  const onSuccess = (source: WorkspaceSource): void => {
    client.setQueryData(queryKeys.source(workspaceId, sourceId), source);
    void client.invalidateQueries({ queryKey: queryKeys.sources(workspaceId) });
  };
  const bibliography = useMutation<WorkspaceSource, ApiError, SourceBibliography>({
    mutationFn: (metadata) => saveSourceBibliography(workspaceId, sourceId, metadata),
    onSuccess,
  });
  const organization = useMutation<WorkspaceSource, ApiError, SourceOrganization>({
    mutationFn: (details) => saveSourceOrganization(workspaceId, sourceId, details),
    onSuccess,
  });
  return { bibliography, organization };
}
