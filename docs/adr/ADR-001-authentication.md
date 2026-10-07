# ADR-001: Browser authentication uses a server-side session in an HttpOnly cookie

## Status

Accepted. 2026-09-23.

This ADR is binding on every later authentication task. Subsequent work follows it and must not
introduce a second mechanism. Changing the decision means superseding this ADR, not adding a
parallel token flow beside it.

## Context

ResearchHub is a React SPA talking to a Spring Boot modular monolith. Authentication is not
implemented yet, and [docs/context.md](../context.md) section 21 previously left "JWT or session"
open. That choice has to be settled before the first login endpoint exists, because the decision
leaks into the frontend HTTP client, CSRF handling, logout semantics, and eventually OAuth wiring.
Deciding it later, after code assumes one shape, is the expensive path.

What the decision has to fit:

- **Two local origins.** The dev server runs on port 3000; the API on 8080. The Webpack dev server
  proxies `/api` and `/actuator` to the backend, so in development the browser only ever calls its
  own origin. See [frontend-api.md](../development/frontend-api.md).
- **Future federated login.** GitHub, Google, Microsoft, and university SSO are all plausible
  ([context.md](../context.md) section 21). Whatever is chosen should not have to be rebuilt to add
  them.
- **Authorization stays server-side.** Every workspace-scoped operation is authorized in Java.
  [context.md](../context.md) sections 12 and 33 are explicit that the frontend is not a security
  boundary and that retrieval must be filtered by workspace permission. The browser credential is
  only an identity claim; it never carries permissions the server then trusts.
- **Revocation matters.** A workspace is a collaboration boundary with OWNER/EDITOR/VIEWER roles.
  Removing someone's access needs to take effect promptly, not at the end of a token lifetime.
- **No security dependency today.** Spring Security is not on the classpath, and 401/403 are
  application exceptions in `shared.error` mapped by `GlobalExceptionHandler`
  ([api-errors.md](../development/api-errors.md)).

## Decision

**Authenticate browsers with a Spring Security server-side session, identified by a session cookie
that is `HttpOnly`, `Secure`, and `SameSite`.**

Specifically:

- The session identifier lives in a cookie the browser cannot read from JavaScript (`HttpOnly`).
- The cookie is `Secure`, so it is not sent over plaintext HTTP. Local development over
  `http://localhost` is the documented exception browsers already permit.
- `SameSite` is set (`Lax` at minimum) to limit cross-site submission.
- Session state lives on the server. The cookie is an opaque key, not a claims document.
- **No authentication token of any kind is stored in `localStorage` or `sessionStorage`,** and no
  long-lived credential is placed anywhere JavaScript can read it.
- Logout invalidates the server-side session.

## Alternatives considered

### Short-lived JWT access token plus refresh token

Rejected for now.

A JWT flow means issuing a short-lived access token and a longer-lived refresh token, rotating the
refresh token, and deciding where each lives in the browser. It buys stateless verification, which
matters when many independent services must validate a credential without a shared session store.
ResearchHub is one Spring application ([context.md](../context.md) section 18 keeps it a modular
monolith deliberately), so there is no service fan-out to justify the cost.

Concrete costs it would add now:

- **Revocation becomes a problem to solve rather than a property.** A self-contained token is valid
  until it expires. Removing a member from a workspace, disabling an account, or responding to a
  stolen token needs a denylist or a very short access-token lifetime with frequent refreshes —
  which reintroduces server state and rebuilds most of what a session already provides.
- **Token storage has no good answer in a browser.** See below.
- **More moving parts before the first login works:** issuing, signing-key management, expiry,
  refresh rotation, and replay handling.

Deferred, not forbidden: if ResearchHub later needs to authenticate a non-browser client (the
planned Python `ai-worker/`, a CLI, or a mobile client), a token-based scheme for *those* clients
can be added without changing this ADR, which governs **browser** authentication. Such a scheme must
not be retrofitted onto the SPA as a second browser mechanism.

### Tokens in `localStorage` versus an HttpOnly cookie

Rejected: any scheme that puts a credential in `localStorage` or `sessionStorage`.

Anything JavaScript can read, injected JavaScript can read. ResearchHub's roadmap makes this worse
than usual: the product renders rich collaborative documents, AI-generated content, and parsed text
extracted from uploaded PDFs and DOCX files ([context.md](../context.md) sections 9, 10, 13). That is
a large surface for cross-site scripting, and much of the content originates outside the app. A
successful XSS against a `localStorage` token exfiltrates a credential the attacker can replay
offline, from anywhere, for as long as it is valid.

An `HttpOnly` cookie is not immune to XSS — injected script can still issue authenticated requests
as the user. The difference is that the attack is confined to the victim's browser session and dies
with the session, instead of yielding a portable credential.

The trade is that cookies are attached automatically, which creates CSRF exposure that
`localStorage` tokens do not have. CSRF is a well-understood, server-side problem with a standard
defence; XSS token theft is neither confined nor easily recovered from. We accept CSRF handling as
the lesser cost.

## Security implications

**XSS.** `HttpOnly` prevents credential *theft*, not abuse during an active session. XSS remains a
first-class concern: keep React's default escaping, never build DOM from unsanitised source text or
model output, and sanitise rich-text and parsed-document HTML before rendering.

**CSRF.** Because the browser attaches the cookie automatically, state-changing requests need CSRF
protection. The strategy, to be implemented with the login task:

- Spring Security's CSRF token repository, with the token readable by the SPA and echoed in a
  request header. `CookieCsrfTokenRepository` with `HttpOnly=false` **for the CSRF token only** is
  the intended shape: the CSRF token is not a credential, and the SPA must be able to read it. The
  session cookie stays `HttpOnly`.
- `SameSite` on the session cookie as defence in depth, not as the only defence.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) stay exempt; every mutating endpoint is protected.

**Cookie flags.** `HttpOnly` always. `Secure` always, except that `http://localhost` development is
permitted. `SameSite=Lax` at minimum; `Strict` is preferable if it does not break a future OAuth
redirect return.

**Logout and revocation.** Logout invalidates the server session, so the credential stops working
immediately. Disabling an account or removing a workspace membership takes effect on the next
request rather than at token expiry. This is the main reason a session is a better fit than a JWT for
a collaboration product with revocable roles. The `users.status` column
(`ACTIVE`/`DISABLED`/`LOCKED`, added in RH-041) exists so an account can be disabled without
deleting the row.

**Session fixation.** Spring Security rotates the session identifier on authentication by default.
Keep that default.

**No credentials in browser storage.** Restating it because it is the part most easily eroded by a
later convenience change: no access token, refresh token, or API key in `localStorage`,
`sessionStorage`, or a non-`HttpOnly` cookie.

**The cookie identifies; it does not authorize.** Workspace permission checks happen server-side per
request. No role, entitlement, or workspace list travels in a browser-held credential where it could
be tampered with or used to skip a check.

## Consequences for later tasks

**This task adds no dependency.** `spring-boot-starter-security` is deliberately **not** added here.
Its default filter chain secures every endpoint as soon as it is on the classpath, which would demand
authentication for `/actuator/health` and break existing tests ([health.md](../development/health.md)
documents those probes as unauthenticated). The starter arrives with the login task, together with
the filter chain configuration that decides what is public.

**Password hashing.** `spring-security-crypto` provides the password encoder when login is
implemented. RH-041 stores a `password_hash` column and accepts only an already-hashed value, so
nothing depends on the starter yet.

**Error contract is unchanged.** When security filters exist, they translate framework
authentication and authorization failures into `UnauthenticatedException` and `ForbiddenException` so
that [api-errors.md](../development/api-errors.md) stays the client contract: `401 UNAUTHENTICATED`
and `403 FORBIDDEN` with the same `ProblemDetail` body and stable `code`. Security filters must not
emit their own error shape.

**Module ownership.** `auth` owns session mechanics, the Spring Security filter chain, the password
encoder, and CSRF configuration. `user` owns the user record and its password hash. The `auth`
package is not created until the login task needs it; see
[backend-architecture.md](../development/backend-architecture.md).

**Frontend credential mode stays as it is.** `frontend/src/shared/api/credentialsPolicy.ts` remains
`'same-origin'`. That is already correct for a cookie session while the dev-server proxy makes the
API same-origin, so no change is needed now, and flipping it early would be a silent no-op that
looks like a decision. If a deployment ever serves the SPA and the API on different origins, that
deployment needs: `credentials: 'include'`, a backend CORS configuration with
`allowCredentials=true` and an explicit origin allowlist (never `*` with credentials), and
`SameSite=None; Secure` on the session cookie. Prefer instead to serve both from one origin, or put
the API behind the same origin at the edge, which keeps `'same-origin'` and avoids that whole
category.

**OAuth later fits this decision.** Adding GitHub, Google, Microsoft, or university SSO means adding
an OAuth2 login flow to the same Spring Security filter chain. The provider authenticates the user;
the result is still a ResearchHub server-side session in the same `HttpOnly` cookie. The browser
storage rule does not change, and no provider token is handed to the SPA.

**Scope this ADR does not cover.** Where session state lives when ResearchHub is deployed to more
than one instance (in-application, Redis, or another external store) is an operational decision for
the deployment task. It does not change the browser-facing contract above. `context.md` section 37
lists Redis as intentionally open; that stays open.

RH-307/RH-308 select PostgreSQL via Spring Session JDBC for the `demo` and `azure` profiles.
This implements the operational storage decision without changing this authentication contract.
Flyway owns the session schema; independent replicas and full restarts are covered by real HTTP tests.
Store selection, expiry and serialization details are in [configuration.md](../development/configuration.md#browser-sessions-rh-307--rh-308).
