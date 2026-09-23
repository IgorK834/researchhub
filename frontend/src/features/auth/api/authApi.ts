import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';

/**
 * Transport for the auth endpoints. Everything goes through the shared client, so the credentials
 * mode, CSRF header, and error decoding are the same as everywhere else.
 */

/** Public user metadata. Mirrors the backend's `UserResponse`; no credential material exists on it. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/**
 * Obtains the CSRF cookie.
 *
 * A freshly loaded page may not have one yet, and its first request is a POST, which the backend
 * would reject. Calling this first is the documented way to prime it.
 */
export function primeCsrfToken(): Promise<void> {
  return apiClient.get<void>(CSRF_PRIMING_PATH);
}

/**
 * Creates an account. Does not sign the user in — the backend returns 201 without a session, so the
 * caller logs in afterwards.
 *
 * The password is passed straight through to the request body and is never stored, logged, or cached.
 */
export async function register(input: RegisterInput): Promise<AuthenticatedUser> {
  await primeCsrfToken();
  return apiClient.post<AuthenticatedUser>('/api/auth/register', { body: input });
}

/** Verifies credentials and establishes the session cookie. */
export async function login(input: LoginInput): Promise<AuthenticatedUser> {
  await primeCsrfToken();
  return apiClient.post<AuthenticatedUser>('/api/auth/login', { body: input });
}

/**
 * Canonical identity endpoint. `GET /api/auth/me` is a compatible alias returning the same body; both
 * are served by one backend method. See docs/development/frontend-api.md.
 */
const CURRENT_USER_PATH = '/api/me';

/**
 * The user the session cookie belongs to. Throws `ApiError` with code `UNAUTHENTICATED` when there is
 * no usable session.
 *
 * This is what restores the user after a browser reload: the page keeps nothing, the browser still
 * holds the cookie, and the answer comes from the server.
 */
export function fetchCurrentUser(signal?: AbortSignal): Promise<AuthenticatedUser> {
  return apiClient.get<AuthenticatedUser>(CURRENT_USER_PATH, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Ends the session.
 *
 * The server invalidates it, so there is no token for this function to discard — the browser keeps a
 * cookie that no longer resolves to anything. Clearing the cached user is the caller's job; see
 * `useLogout`.
 */
export async function logout(): Promise<void> {
  await primeCsrfToken();
  await apiClient.post<void>('/api/auth/logout');
}
