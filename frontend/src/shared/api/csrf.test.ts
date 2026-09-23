/**
 * @jest-environment jsdom
 */
import { CSRF_COOKIE_NAME, readCsrfToken, requiresCsrfToken } from './csrf';

function setCookies(value: string): void {
  Object.defineProperty(document, 'cookie', {
    value,
    writable: true,
    configurable: true,
  });
}

describe('requiresCsrfToken', () => {
  it('requires a token for methods that change state', () => {
    expect(requiresCsrfToken('POST')).toBe(true);
    expect(requiresCsrfToken('PUT')).toBe(true);
    expect(requiresCsrfToken('PATCH')).toBe(true);
    expect(requiresCsrfToken('DELETE')).toBe(true);
  });

  it('exempts safe methods', () => {
    expect(requiresCsrfToken('GET')).toBe(false);
    expect(requiresCsrfToken('HEAD')).toBe(false);
    expect(requiresCsrfToken('OPTIONS')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(requiresCsrfToken('post')).toBe(true);
  });
});

describe('readCsrfToken', () => {
  it('finds the token among other cookies', () => {
    setCookies(`other=first; ${CSRF_COOKIE_NAME}=the-token; trailing=last`);

    expect(readCsrfToken()).toBe('the-token');
  });

  it('reads a token that is the only cookie', () => {
    setCookies(`${CSRF_COOKIE_NAME}=solo-token`);

    expect(readCsrfToken()).toBe('solo-token');
  });

  it('decodes a percent-encoded value', () => {
    setCookies(`${CSRF_COOKIE_NAME}=a%2Fb%2Bc`);

    expect(readCsrfToken()).toBe('a/b+c');
  });

  it('returns null when no CSRF cookie is present', () => {
    setCookies('unrelated=value');

    expect(readCsrfToken()).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the CSRF name', () => {
    setCookies(`NOT-${CSRF_COOKIE_NAME}=decoy`);

    expect(readCsrfToken()).toBeNull();
  });

  it('returns null when there are no cookies at all', () => {
    setCookies('');

    expect(readCsrfToken()).toBeNull();
  });
});
