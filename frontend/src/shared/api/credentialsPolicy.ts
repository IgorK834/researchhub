/**
 * Single place that decides whether the browser attaches credentials to API requests.
 *
 * Today there is no authentication: the backend has no Spring Security on the classpath, so
 * nothing depends on a cookie or an `Authorization` header. `same-origin` is the conservative
 * choice that still works through the development proxy, where the API is same-origin anyway.
 *
 * When the `auth` module lands:
 * - A cookie session needs `'include'` here, plus a backend CORS configuration that allows
 *   credentials, unless the frontend is always served from the API's origin (or proxied to it,
 *   as in development), in which case `'same-origin'` remains correct.
 * - A bearer-token scheme needs no change here; the token belongs in a request header, which
 *   the client's `headers` option already supports.
 *
 * Changing this value is a security-relevant decision. Do not override it per call site.
 */
export const apiCredentials: RequestCredentials = 'same-origin';
