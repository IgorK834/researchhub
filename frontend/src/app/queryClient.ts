import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '../shared/api';

/** HTTP statuses where retrying cannot change the outcome. */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 415, 422]);

const MAX_RETRIES = 2;

/**
 * Application QueryClient.
 *
 * TanStack Query owns *server* state only. Local UI and editor state stays in React state or a
 * dedicated store — do not push form drafts, selection, or modal flags through the query cache.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that navigating between routes does not refetch constantly, short enough
        // that a developer editing backend data still sees changes without a hard reload.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // A deliberate client-side error (validation, permissions, missing resource) will not
          // succeed on retry; only transport failures and 5xx are worth a second attempt.
          if (isApiError(error) && NON_RETRYABLE_STATUSES.has(error.status)) {
            return false;
          }
          return failureCount < MAX_RETRIES;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Mutations are never retried automatically: a retried write can duplicate an effect.
        retry: false,
      },
    },
  });
}
