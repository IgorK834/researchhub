/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LoginPage } from './LoginPage';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

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

function emptyNoContent(): Response {
  return {
    ok: true,
    status: 204,
    statusText: '',
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

/**
 * Answers the CSRF priming GET, then the login POST with whatever the test supplies. Mirrors the real
 * two-call sequence the client performs.
 */
function stubLoginResponse(loginResponse: Response): void {
  globalThis.fetch = jest.fn((_url: unknown, init?: RequestInit) =>
    Promise.resolve(
      (init?.method ?? 'GET') === 'POST' ? loginResponse : emptyNoContent(),
    ),
  ) as unknown as typeof fetch;
}

function renderLoginPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<LoginPage />, { wrapper });
}

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a-long-enough-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockNavigate.mockReset();
  jest.restoreAllMocks();
});

describe('LoginPage', () => {
  it('navigates to the app on success', async () => {
    stubLoginResponse(
      jsonResponse(
        { id: 'u-1', email: 'ada@example.com', displayName: 'Ada', status: 'ACTIVE' },
        200,
        'application/json',
      ),
    );

    renderLoginPage();
    fillAndSubmit();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app');
    });
  });

  it('shows one generic message when the credentials are rejected', async () => {
    stubLoginResponse(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Unauthenticated',
          status: 401,
          detail: 'Invalid email or password',
          code: 'UNAUTHENTICATED',
        },
        401,
        'application/problem+json',
      ),
    );

    renderLoginPage();
    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Invalid email or password.',
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('never renders the submitted password', async () => {
    stubLoginResponse(
      jsonResponse(
        { detail: 'Invalid email or password', code: 'UNAUTHENTICATED', status: 401 },
        401,
        'application/problem+json',
      ),
    );

    renderLoginPage();
    fillAndSubmit();

    await screen.findByRole('alert');
    // The value stays in the password input (type=password) but must not be echoed into page text.
    expect(document.body.textContent).not.toContain('a-long-enough-password');
  });
});
