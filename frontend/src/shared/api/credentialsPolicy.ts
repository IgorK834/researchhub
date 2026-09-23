/**
 * Single place that decides whether the browser attaches credentials to API requests.
 *
 * Today there is no authentication: the backend has no Spring Security on the classpath, so
 * nothing depends on a cookie yet. `same-origin` is the conservative choice that also happens to
 * be the correct long-term one, because the development proxy makes the API same-origin.
 *
 * The mechanism is decided in docs/adr/ADR-001-authentication.md: a server-side session whose id
 * travels in an `HttpOnly`, `Secure`, `SameSite` cookie. No token is ever stored in
 * `localStorage` or `sessionStorage`, so this module is the only place credentials are configured
 * and there is no token for application code to hold.
 *
 * `'same-origin'` stays correct once that session exists, as long as the SPA and the API share an
 * origin — which the dev-server proxy guarantees in development. A deployment that serves them on
 * different origins would need `'include'` here, a backend CORS configuration with
 * `allowCredentials=true` and an explicit origin allowlist, and `SameSite=None; Secure` on the
 * session cookie. Serving both from one origin avoids that entirely and is preferred.
 *
 * Changing this value is a security-relevant decision. Do not override it per call site.
 */
export const apiCredentials: RequestCredentials = 'same-origin';
