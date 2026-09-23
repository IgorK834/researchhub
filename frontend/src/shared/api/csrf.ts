/**
 * CSRF token plumbing for the cookie session described in docs/adr/ADR-001-authentication.md.
 *
 * Because the session cookie is attached to every request automatically, a mutating request has to
 * carry proof that our own page issued it. The backend writes a token into a cookie that, unlike the
 * session cookie, is deliberately readable by JavaScript: it is not a credential, it only has to be
 * echoed back in a header the browser will not set on a cross-site form post.
 */

/** Cookie the backend writes the token into. Spring Security's default name. */
export const CSRF_COOKIE_NAME = 'XSRF-TOKEN';

/** Header the token must be echoed in. Spring Security's default name. */
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/** Endpoint that issues the cookie for a client that does not have one yet. */
export const CSRF_PRIMING_PATH = '/api/auth/csrf';

/** HTTP methods the backend requires a CSRF token for. Safe methods are exempt. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requiresCsrfToken(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * Reads the CSRF token the backend set, or `null` when no cookie is present.
 *
 * Returning `null` rather than throwing is deliberate: the request still goes out and the backend
 * answers with `403 FORBIDDEN`, which is a real answer the UI can surface. Failing here instead would
 * turn a server-side rule into a client-side one and produce a different error shape.
 */
export function readCsrfToken(): string | null {
  // `document` is absent in a non-browser context, for instance a unit test of transport code.
  if (typeof document === 'undefined') {
    return null;
  }

  for (const entry of document.cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const name = entry.slice(0, separator).trim();
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  }

  return null;
}
