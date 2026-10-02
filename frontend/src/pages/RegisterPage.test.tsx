/** @jest-environment jsdom */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RegisterPage } from './RegisterPage';
import { queryKeys } from '../shared/api';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const user = {
  id: 'u-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  status: 'ACTIVE',
};
const password = ' a-long-enough-password ';
const originalFetch = globalThis.fetch;

function response(body: unknown, status = 201): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: () => (status >= 400 ? 'application/problem+json' : 'application/json'),
    },
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function stubRegistration(result: Response | Promise<Response>): jest.Mock {
  const fetchMock = jest.fn((_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(result);
    document.cookie = 'XSRF-TOKEN=registration%20csrf; Path=/';
    return Promise.resolve(response(null, 204));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderRegisterPage(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<RegisterPage />, { wrapper });
  return client;
}

function fillForm(confirmation = password): void {
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: confirmation },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/';
  mockNavigate.mockReset();
  jest.restoreAllMocks();
});

describe('RegisterPage', () => {
  it('creates an account after CSRF priming, excluding confirmation, then returns to login', async () => {
    const fetchMock = stubRegistration(response(user));
    const persist = jest.spyOn(Storage.prototype, 'setItem');
    const client = renderRegisterPage();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/auth/csrf',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    ]);
    const [url, request] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/auth/register');
    expect(request).toEqual(
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': 'registration csrf' }),
      }),
    );
    expect(JSON.parse(request!.body as string)).toEqual({
      displayName: 'Ada',
      email: 'ada@example.com',
      password,
    });
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Confirm password')).toHaveProperty('value', '');
    expect(client.getQueryData(queryKeys.currentUser())).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it('shows mismatch while typing, before any submit or API request, and clears it on correction', () => {
    const fetchMock = stubRegistration(response(user));
    renderRegisterPage();
    fillForm(password.trim());
    const confirm = screen.getByLabelText('Confirm password');
    const message = screen.getByText('Passwords do not match.');
    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    expect(confirm.getAttribute('aria-describedby')).toBe(message.id);
    expect(message.id).toBe('confirmPassword-error');
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(confirm, { target: { value: password } });
    expect(screen.queryByText('Passwords do not match.')).toBeNull();
    expect(confirm.getAttribute('aria-invalid')).toBe('false');
    expect(confirm.hasAttribute('aria-describedby')).toBe(false);
  });

  it('blocks mismatched submission and focuses confirmation without contacting the server', () => {
    const fetchMock = stubRegistration(response(user));
    renderRegisterPage();
    fillForm('different-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Confirm password'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(password);
    expect(document.body.textContent).not.toContain('different-password');
  });

  it('validates an empty confirmation on blur and revalidates if the original password changes', () => {
    stubRegistration(response(user));
    renderRegisterPage();
    fillForm('');
    expect(screen.queryByText('Passwords do not match.')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Confirm password'));
    expect(screen.getByText('Passwords do not match.')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: password },
    });
    expect(screen.queryByText('Passwords do not match.')).toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'another-password' },
    });
    expect(screen.getByText('Passwords do not match.')).toBeDefined();
  });

  it('validates a missing confirmation on submit even when it has never been focused', () => {
    const fetchMock = stubRegistration(response(user));
    renderRegisterPage();
    fillForm('');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Passwords do not match.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves server field messages and their associations', async () => {
    stubRegistration(
      response(
        {
          status: 400,
          code: 'VALIDATION_FAILED',
          detail: 'Validation failed',
          errors: [
            { field: 'displayName', message: 'Display name must not be blank' },
            { field: 'email', message: 'Email must be valid' },
            { field: 'password', message: 'Password must have at least 10 characters' },
          ],
        },
        400,
      ),
    );
    renderRegisterPage();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Email must be valid');
    for (const [label, message] of [
      ['Display name', 'Display name must not be blank'],
      ['Email', 'Email must be valid'],
      ['Password', 'Password must have at least 10 characters'],
    ]) {
      const input = screen.getByLabelText(label!);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe(screen.getByText(message!).id);
    }
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe(
      'false',
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'places a duplicate email error beside email (field error: %s)',
    async (fieldError) => {
      stubRegistration(
        response(
          {
            status: 409,
            code: 'CONFLICT',
            detail: 'An account with this email already exists.',
            ...(fieldError
              ? {
                  errors: [{ field: 'email', message: 'Use a different email address.' }],
                }
              : {}),
          },
          409,
        ),
      );
      renderRegisterPage();
      fillForm();
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
      const message = await screen.findByText(
        fieldError
          ? 'Use a different email address.'
          : 'An account with this email already exists.',
      );
      expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(
        message.id,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it('preserves a general API error announcement and allows retry', async () => {
    const fetchMock = stubRegistration(
      response(
        { status: 500, code: 'INTERNAL_ERROR', detail: 'Please try again later.' },
        500,
      ),
    );
    renderRegisterPage();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Please try again later.',
    );
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveProperty(
      'disabled',
      false,
    );
    fetchMock.mockImplementation((_url: unknown, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? response(user) : response(null, 204)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  });

  it('blocks repeated submission while pending and preserves the progress copy', async () => {
    let resolve!: (result: Response) => void;
    const fetchMock = stubRegistration(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    renderRegisterPage();
    fillForm();
    const button = screen.getByRole('button', { name: 'Create account' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveProperty('disabled', true));
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBe(button);
    fireEvent.submit(button.closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolve(response(user));
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  });

  it('keeps the login link, legal copy, labels and password autocomplete available', () => {
    stubRegistration(response(user));
    renderRegisterPage();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Register', level: 1 })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
      '/login',
    );
    expect(
      screen.getByText('By creating an account you accept the Terms and Privacy policy.'),
    ).toBeDefined();
    for (const label of ['Password', 'Confirm password']) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('type')).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
    }
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });
});
