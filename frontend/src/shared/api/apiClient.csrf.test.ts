/**
 * @jest-environment jsdom
 */
import { request } from './apiClient';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './csrf';

/** Minimal `Response` double: jsdom does not implement the Fetch API response classes. */
function emptyOkResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: '',
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

function capturingFetch(): jest.Mock {
  const mock = jest.fn(() => Promise.resolve(emptyOkResponse()));
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function headersOf(mock: jest.Mock): Record<string, string> {
  const init = mock.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

function setCookies(value: string): void {
  Object.defineProperty(document, 'cookie', {
    value,
    writable: true,
    configurable: true,
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('request CSRF handling', () => {
  it('sends the CSRF header on a mutating request', async () => {
    setCookies(`${CSRF_COOKIE_NAME}=token-abc`);
    const mock = capturingFetch();

    await request('POST', '/api/auth/login', { body: { email: 'a@b.co' } });

    expect(headersOf(mock)[CSRF_HEADER_NAME]).toBe('token-abc');
  });

  it('does not send the CSRF header on a safe request', async () => {
    setCookies(`${CSRF_COOKIE_NAME}=token-abc`);
    const mock = capturingFetch();

    await request('GET', '/api/auth/me');

    expect(headersOf(mock)[CSRF_HEADER_NAME]).toBeUndefined();
  });

  it('still sends the request when no CSRF cookie exists, letting the backend answer', async () => {
    setCookies('');
    const mock = capturingFetch();

    await request('POST', '/api/auth/login', { body: {} });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(headersOf(mock)[CSRF_HEADER_NAME]).toBeUndefined();
  });

  it('always sends credentials so the session cookie is attached', async () => {
    setCookies(`${CSRF_COOKIE_NAME}=token-abc`);
    const mock = capturingFetch();

    await request('GET', '/api/auth/me');

    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
  });

  it('sends form data without overriding the browser generated multipart boundary', async () => {
    const mock = capturingFetch();
    const formData = new FormData();
    formData.append('file', new File(['a,b'], 'data.csv', { type: 'text/csv' }));

    await request('POST', '/api/workspaces/w-1/sources', { formData });

    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(formData);
    expect(headersOf(mock)['Content-Type']).toBeUndefined();
  });

  it('refuses ambiguous JSON and form bodies before sending', async () => {
    const mock = capturingFetch();

    await expect(
      request('POST', '/api/workspaces/w-1/sources', {
        body: {},
        formData: new FormData(),
      }),
    ).rejects.toThrow('both a JSON body and form data');
    expect(mock).not.toHaveBeenCalled();
  });
});
