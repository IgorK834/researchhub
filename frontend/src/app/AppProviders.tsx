import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from './queryClient';

interface AppProvidersProps {
  readonly children: ReactNode;
}

/**
 * Application-wide providers. New cross-cutting context (auth session, theme) belongs here so
 * the router and pages stay unaware of provider ordering.
 */
export function AppProviders({ children }: AppProvidersProps): ReactElement {
  // Created once per mount rather than at module scope, so the cache is not shared across
  // tests or a future server-render.
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
