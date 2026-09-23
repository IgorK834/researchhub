import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getHealth, queryKeys, type HealthResponse } from '../api';

/**
 * React binding for the sample health endpoint.
 *
 * `shared/api` stays free of React so it can be unit tested without a renderer; hooks that adapt
 * it to TanStack Query live here (or, for product areas, in `features/<name>/api/`).
 *
 * The `signal` TanStack Query supplies is forwarded to `fetch`, so an unmounted component's
 * request is aborted instead of resolving into a discarded cache entry.
 */
export function useHealthQuery(): UseQueryResult<HealthResponse, Error> {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => getHealth(signal),
  });
}
