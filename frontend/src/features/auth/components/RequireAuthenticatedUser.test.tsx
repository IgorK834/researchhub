/**
 * @jest-environment jsdom
 */
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { RequireAuthenticatedUser } from './RequireAuthenticatedUser';

const PROTECTED_CONTENT = 'Workspace body that must stay hidden';
const LOGIN_MARKER = 'Login form';

/** Minimal `Response` double: jsdom does not implement the Fetch API response classes. */
function jsonResponse(body: unknown, status: number, contentType: string): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: () => Promise.resolve(payload),
  } as unknown as Response;
}

function stubFetch(implementation: () => Promise<Response>): void {
  globalThis.fetch = jest.fn(implementation) as unknown as typeof fetch;
}

/** Mirrors the real router shape: the guard is the element, the page is a nested route. */
function renderGuardedApp(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/workspaces/w1/documents/d1']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  render(
    <Routes>
      <Route path="/login" element={<p>{LOGIN_MARKER}</p>} />
      <Route path="/app" element={<RequireAuthenticatedUser />}>
        <Route
          path="workspaces/:workspaceId/documents/:documentId"
          element={<p>{PROTECTED_CONTENT}</p>}
        />
      </Route>
    </Routes>,
    { wrapper },
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('RequireAuthenticatedUser', () => {
  it('hides protected content while the session check is in flight', () => {
    // A promise that never settles keeps the query pending.
    stubFetch(() => new Promise<Response>(() => {}));

    renderGuardedApp();

    expect(screen.getByRole('status').textContent).toContain('Checking your session');
    expect(screen.queryByText(PROTECTED_CONTENT)).toBeNull();
    expect(screen.queryByText(LOGIN_MARKER)).toBeNull();
  });

  it('renders the protected route once a user is known', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', status: 'ACTIVE' },
          200,
          'application/json',
        ),
      ),
    );

    renderGuardedApp();

    expect(await screen.findByText(PROTECTED_CONTENT)).not.toBeNull();
  });

  it('redirects to the login page when there is no session', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          { status: 401, detail: 'Authentication is required', code: 'UNAUTHENTICATED' },
          401,
          'application/problem+json',
        ),
      ),
    );

    renderGuardedApp();

    expect(await screen.findByText(LOGIN_MARKER)).not.toBeNull();
    // The protected content must never have rendered, not even for a frame before the redirect.
    expect(screen.queryByText(PROTECTED_CONTENT)).toBeNull();
  });

  it('reports a failed check instead of treating it as a signed-out user', async () => {
    // The backend is unreachable, which is not the same as "not logged in".
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    renderGuardedApp();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not check your session');
    expect(screen.queryByText(LOGIN_MARKER)).toBeNull();
    expect(screen.queryByText(PROTECTED_CONTENT)).toBeNull();
  });

  it('asks the canonical identity endpoint', async () => {
    // Typed parameters so the recorded calls are a tuple TypeScript will let us index.
    const mock = jest.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse(
          { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', status: 'ACTIVE' },
          200,
          'application/json',
        ),
      ),
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    renderGuardedApp();

    await waitFor(() => {
      expect(mock).toHaveBeenCalled();
    });
    expect(mock.mock.calls[0]?.[0]).toBe('/api/me');
  });
});
