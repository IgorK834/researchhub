import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '../../../shared/api';
import { fetchDatasetPreview, type DatasetPreview } from './datasetPreviewApi';

/**
 * A source version is immutable, so its preview never goes stale: it is cached for the session and not refetched on
 * focus or remount. A preview that was not available yet (the version is still being processed) is retried by the
 * caller changing the version or reloading.
 */
export function useDatasetPreviewQuery(
  workspaceId: string,
  sourceId: string,
  sourceVersionId: string,
): UseQueryResult<DatasetPreview, Error> {
  return useQuery({
    queryKey: queryKeys.datasetPreview(workspaceId, sourceId, sourceVersionId),
    queryFn: ({ signal }) =>
      fetchDatasetPreview(workspaceId, sourceId, sourceVersionId, signal),
    staleTime: Infinity,
  });
}
