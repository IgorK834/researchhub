import type { ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { describeError, isApiError, queryKeys } from '../api';
import { useHealthQuery } from '../hooks/useHealthQuery';
import { Banner } from './feedback';

/**
 * Smoke-test surface for the shared API client and TanStack Query: renders the backend health
 * status with explicit loading, error, and success branches.
 *
 * This is scaffolding, not a product feature. It is the one place that proves the wiring works
 * end to end, and it should be replaced once real workspace data is fetched.
 */
export function ApiStatusBanner(): ReactElement {
  const queryClient = useQueryClient();
  const { data, error, isPending, isFetching } = useHealthQuery();

  // Intentional cache invalidation. Real mutations follow the same pattern: after a successful
  // write, invalidate the narrowest key that covers the affected data, for example
  //   const { mutate } = useMutation({
  //     mutationFn: (input) => createWorkspace(input),
  //     onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() }),
  //   });
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.health() });
  };

  return (
    <section aria-labelledby="api-status-heading">
      <h2 id="api-status-heading">Backend status</h2>

      <Banner
        role="status"
        tone={isPending ? 'info' : error !== null ? 'error' : 'success'}
        icon={isPending ? 'refresh' : undefined}
        lead={
          isPending
            ? 'Checking the API…'
            : error !== null
              ? `Unavailable: ${describeError(error)}${isApiError(error) ? ` (code ${error.code})` : ''}`
              : `API reports ${data?.status ?? 'unknown'}`
        }
      />

      <button type="button" onClick={refresh} disabled={isFetching}>
        {isFetching ? 'Refreshing…' : 'Refresh status'}
      </button>
    </section>
  );
}
