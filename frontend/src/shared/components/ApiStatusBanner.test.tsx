/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { ApiStatusBanner } from './ApiStatusBanner';

/**
 * Verifies the smoke query renders its loading, success, and error states. `fetch` is stubbed
 * rather than calling a real backend, so this stays runnable in CI.
 */
function renderBanner(): void {
  // Retries off so an error state settles immediately instead of after backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  render(<ApiStatusBanner />, { wrapper });
}

/**
 * Minimal `Response` double. jsdom does not implement the Fetch API response classes, so this
 * supplies only the members apiClient reads.
 */
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('ApiStatusBanner', () => {
  it('renders the loading state while the query is pending', () => {
    // A promise that never settles keeps the query pending.
    stubFetch(() => new Promise<Response>(() => {}));

    renderBanner();

    expect(screen.getByRole('status').textContent).toContain('Checking the API');
  });

  it('renders the backend status on success', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          { groups: ['liveness', 'readiness'], status: 'UP' },
          200,
          'application/json',
        ),
      ),
    );

    renderBanner();

    expect(await screen.findByText('API reports UP')).not.toBeNull();
  });

  it('renders the typed error code when the API returns a ProblemDetail', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            detail: 'The requested resource was not found',
            code: 'RESOURCE_NOT_FOUND',
          },
          404,
          'application/problem+json',
        ),
      ),
    );

    renderBanner();

    const status = await screen.findByText(/Unavailable/);
    expect(status.textContent).toContain('The requested resource was not found');
    expect(status.textContent).toContain('code RESOURCE_NOT_FOUND');
  });

  it('renders a reachability message when the request never completes', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    renderBanner();

    const status = await screen.findByText(/Could not reach the ResearchHub API/);
    expect(status).not.toBeNull();
  });
});
