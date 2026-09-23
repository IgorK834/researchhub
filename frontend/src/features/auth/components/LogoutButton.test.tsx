/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { queryKeys } from '../../../shared/api';
import { LogoutButton } from './LogoutButton';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: '',
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

let queryClient: QueryClient;

function renderLogoutButton(): void {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Stand in for state the signed-in user's session put in the cache.
  queryClient.setQueryData(queryKeys.currentUser(), {
    id: 'u-1',
    email: 'ada@example.com',
    displayName: 'Ada',
    status: 'ACTIVE',
  });

  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  render(<LogoutButton />, { wrapper });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockNavigate.mockReset();
  jest.restoreAllMocks();
});

describe('LogoutButton', () => {
  it('clears the cached user and leaves for the login page', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(noContentResponse()),
    ) as unknown as typeof fetch;

    renderLogoutButton();
    expect(queryClient.getQueryData(queryKeys.currentUser())).not.toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(queryClient.getQueryData(queryKeys.currentUser())).toBeUndefined();
  });

  it('posts to the logout endpoint', async () => {
    // Typed parameters so the recorded calls are a tuple TypeScript will let us index.
    const mock = jest.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(noContentResponse()),
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    renderLogoutButton();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    const posted = mock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posted?.[0]).toBe('/api/auth/logout');
  });

  it('keeps the user signed in and reports the problem when logout fails', async () => {
    globalThis.fetch = jest.fn((_url: unknown, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'POST'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(noContentResponse()),
    ) as unknown as typeof fetch;

    renderLogoutButton();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not log out');
    expect(mockNavigate).not.toHaveBeenCalled();
    // The session may well still be valid, so the cached user must not be discarded.
    expect(queryClient.getQueryData(queryKeys.currentUser())).not.toBeUndefined();
  });
});
