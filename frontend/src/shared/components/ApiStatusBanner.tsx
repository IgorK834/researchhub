import { t as uiText, useLocale as useUiLocale } from '../i18n';
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
  useUiLocale();
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
      <h2 id="api-status-heading">{uiText('ui.ApiStatusBanner.message001')}</h2>

      <Banner
        role="status"
        tone={isPending ? 'info' : error !== null ? 'error' : 'success'}
        icon={isPending ? 'refresh' : undefined}
        lead={
          isPending
            ? uiText('ui.ApiStatusBanner.message002')
            : error !== null
              ? uiText('ui.ApiStatusBanner.message004', {
                  value0: describeError(error),
                  value1: isApiError(error)
                    ? uiText('ui.ApiStatusBanner.message005', { value0: error.code })
                    : '',
                })
              : uiText('ui.ApiStatusBanner.message006', {
                  value0: data?.status ?? uiText('ui.DatasetPreviewPanel.message067'),
                })
        }
      />

      <button type="button" onClick={refresh} disabled={isFetching}>
        {isFetching
          ? uiText('ui.ApiStatusBanner.message003')
          : uiText('ui.SourceDetailPage.message009')}
      </button>
    </section>
  );
}
