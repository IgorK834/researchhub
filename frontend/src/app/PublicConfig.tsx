import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api';

export type RegistrationMode = 'open' | 'invite-only' | 'disabled';
export type AiMode =
  | { readonly mode: 'deterministic'; readonly modelName: null }
  | { readonly mode: 'live'; readonly modelName: string };
export interface PublicConfig {
  readonly environment: string;
  readonly demo: boolean;
  readonly registrationMode: RegistrationMode;
  readonly ai: AiMode;
}
export interface RuntimeConfigState {
  readonly config: PublicConfig | undefined;
  readonly pending: boolean;
  readonly failed: boolean;
}
// Missing configuration keeps account creation closed and AI identity explicitly unknown.
export const PublicConfigContext = createContext<RuntimeConfigState>({
  config: undefined,
  pending: true,
  failed: false,
});
export function usePublicConfig(): RuntimeConfigState {
  return useContext(PublicConfigContext);
}

export function PublicConfigProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const query = useQuery({
    queryKey: ['public-config'],
    queryFn: ({ signal }) =>
      apiClient.get<PublicConfig>('/api/public/config', { signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  return (
    <PublicConfigContext.Provider
      value={{ config: query.data, pending: query.isPending, failed: query.isError }}
    >
      {children}
    </PublicConfigContext.Provider>
  );
}
