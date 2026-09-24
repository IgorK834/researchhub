# Frontend API layer

How the React app talks to the Spring backend, and how server state is cached. The `src/` layout
this builds on: [frontend-structure.md](frontend-structure.md). The error contract it decodes:
[api-errors.md](api-errors.md).

## One rule

Components, pages, and hooks do not call `fetch`. Every request goes through `shared/api`.

That keeps four decisions in one place: the base URL, the credentials mode, JSON encoding, and
how a failure becomes a typed error. A stray `fetch` in a component silently opts out of all of
them.

## Modules

`frontend/src/shared/api/`

| Module | Responsibility |
| --- | --- |
| `config.ts` | Reads `RESEARCHHUB_API_BASE_URL` and joins it with a request path. |
| `credentialsPolicy.ts` | The single `RequestCredentials` value for every request. |
| `apiError.ts` | `ApiError`, `ApiTransportError`, the `ApiErrorCode` union, type guards. |
| `parseProblemDetail.ts` | Decodes a `ProblemDetail` body; synthesises one when the body is unusable. |
| `apiClient.ts` | `request()` plus `apiClient.get/post/put/patch/delete`. |
| `health.ts` | Sample endpoint: `getHealth()` against `GET /actuator/health`. |
| `queryKeys.ts` | TanStack Query key factory. |
| `index.ts` | Public surface. Import from `shared/api`, not from the modules directly. |

`shared/api` contains no React, so it is unit-testable without a renderer. React bindings live in
`shared/hooks/` (cross-cutting) or `features/<name>/api/` (product areas).

## Base URL and the dev proxy

`RESEARCHHUB_API_BASE_URL` is injected at build time by Webpack's `DefinePlugin`. It defaults to
an empty string, which means **same-origin relative requests** (`/actuator/health`, not
`http://localhost:8080/actuator/health`).

In development the Webpack dev server proxies `/api` and `/actuator` to the backend:

```text
browser :3000  ──>  webpack-dev-server  ──>  backend :8080
                     proxy /api, /actuator
```

The browser therefore never makes a cross-origin call, and the backend needs no CORS
configuration. Override the proxy target with `RESEARCHHUB_DEV_API_TARGET` when the backend is not
on `http://localhost:8080`.

Set `RESEARCHHUB_API_BASE_URL` explicitly only when the API genuinely lives on another origin. At
that point the backend must also allow that origin, and the credentials policy below has to be
revisited. Variable naming and the rule that `RESEARCHHUB_*` values are public:
[configuration.md](configuration.md).

## Errors

Two failure types, deliberately distinct:

| Type | Meaning | Has `code`? |
| --- | --- | --- |
| `ApiError` | The server answered with a non-2xx status. | Yes |
| `ApiTransportError` | No usable response: backend down, DNS/connection failure, or an undecodable body. | No |

An aborted request rethrows the original `AbortError` untouched, so TanStack Query's cancellation
keeps working.

`ApiError.problem` is always populated. When the response carried a real `application/problem+json`
body it is decoded; when it did not (an HTML error page from a proxy, an empty body) a stand-in is
synthesised from the HTTP status with `code: 'UNKNOWN'`. Call sites therefore always read one shape.

Branch on `code`, not on status and never on a Java class name:

```ts
import { hasApiErrorCode, isApiError } from '../shared/api';

if (hasApiErrorCode(error, 'VALIDATION_FAILED')) {
  // error.fieldErrors is [{ field, message }, ...]
} else if (isApiError(error) && error.code === 'FORBIDDEN') {
  // not a member of this workspace
}
```

`error.problem.currentRevision` is set only on the `CONFLICT` for a stale document revision, and is
decoded only when it is a positive integer. Treat it as optional: the document editor shows it when
present and otherwise explains the conflict from `detail`.

A code the frontend does not recognise decodes to `'UNKNOWN'`, with the server's original string
kept on `rawCode`. A backend that adds a code does not crash an older frontend.

`describeError(error)` returns a string safe to render for any of these cases.

## Server state with TanStack Query

The `QueryClient` is created in `app/queryClient.ts` and provided by `app/AppProviders.tsx` at the
root, above the router.

TanStack Query owns **server** state. Local UI and editor state — form drafts, selection, modal
flags, cursor position — stays in React state or a dedicated store. Do not route it through the
query cache to get a global variable.

Defaults worth knowing:

- `staleTime` 30s, so route changes do not refetch constantly.
- Queries do not retry a deliberate client error (400, 401, 403, 404, 405, 409, 413, 415, 422).
  A `FORBIDDEN` will not fix itself; a transport failure or a 5xx might.
- `refetchOnWindowFocus` is off.
- Mutations never retry automatically, because a retried write can duplicate an effect.

### Query keys

Build keys only through `queryKeys` in `shared/api/queryKeys.ts`.

The first element names the resource collection; later elements narrow it from broadest to most
specific. TanStack Query matches keys by **prefix**, so that ordering is what makes targeted
invalidation possible:

```text
queryKeys.health()                          ['health']
queryKeys.workspaces()                      ['workspaces']
queryKeys.workspace(id)                     ['workspaces', id]
queryKeys.documents(workspaceId)            ['documents', workspaceId]
queryKeys.document(workspaceId, documentId)  ['documents', workspaceId, documentId]
queryKeys.sources(workspaceId)              ['sources', workspaceId]
queryKeys.job(jobId)                        ['jobs', jobId]
```

Invalidating `['workspaces']` also invalidates `['workspaces', id]`. Invalidating
`['workspaces', id]` leaves sibling workspaces cached.

### Invalidation after mutations

Invalidate deliberately: pick the narrowest key that covers the data the write actually changed.
Blanket `invalidateQueries()` calls turn one save into a storm of refetches.

```ts
const queryClient = useQueryClient();

const { mutate } = useMutation({
  mutationFn: (input: CreateWorkspaceInput) => createWorkspace(input),
  onSuccess: () => {
    // The list changed. Individual workspaces did not.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() });
  },
});
```

Creating a document invalidates `queryKeys.documents(workspaceId)`, so the new title appears in the
list. Saving one writes the response into `queryKeys.document(workspaceId, documentId)` and
invalidates the list with `exact: true`, so the title updates without refetching the document just
saved. Prefix invalidation of `queryKeys.documents(workspaceId)` also refreshes an open document,
which is what archiving uses.

## Where feature code goes

```text
features/workspaces/api/workspaceApi.ts                transport: apiClient.get('/api/workspaces')
features/workspaces/api/useWorkspaces.ts               hooks: useWorkspacesQuery, useCreateWorkspace
features/workspaces/components/WorkspaceList.tsx       renders the data
features/workspaces/components/CreateWorkspaceForm.tsx owns the form state and the mutation
pages/WorkspaceListPage.tsx                            renders the hook's states
```

The transport function names the endpoint and its types; the hook binds it to a query key; the page
renders loading, error, and success. Feature folders are created when the first file needs them.

`CreateWorkspaceForm` writes out its own label, input, and textarea rather than importing `FormField`
from `features/auth`. One feature must not import from another
([frontend-structure.md](frontend-structure.md)); promote a component to `shared/components/` when a
second feature genuinely needs it, rather than reaching across.

## Current scaffolding

`shared/components/ApiStatusBanner.tsx` is the smoke test for all of the above: it calls
`getHealth()` through the shared client via `useHealthQuery`, renders the loading, error, and
success branches, and invalidates `['health']` on demand. It is wiring proof, not a product
feature.

Real workspace data is now fetched by `features/workspaces`, so the banner has served its purpose and is
due for removal from `AppLayoutPage`. It is still mounted, deliberately — dropping it belongs in its own
change, not bundled into a feature.

## Authentication

Implemented per [ADR-001](../adr/ADR-001-authentication.md): a Spring Security server-side session, with
the session id in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` everywhere except `http://localhost`).
**No token is stored in `localStorage` or `sessionStorage`**, and there is none to store.

### Two cookies, one of them readable

| Cookie | Readable by JavaScript | Role |
| --- | --- | --- |
| `JSESSIONID` | No | The credential. Identifies the server-side session. |
| `XSRF-TOKEN` | Yes | Not a credential. Proof that a mutating request came from our own page. |

Because the credential is an `HttpOnly` cookie, application code never holds or attaches it. There is
nothing for a component to read and no `Authorization` header to set — the browser sends the cookie, and
the client only has to send the right credentials mode, which `credentialsPolicy.ts` sets in one place.

### CSRF

`shared/api/csrf.ts` owns this. `request()` reads the `XSRF-TOKEN` cookie and sends it as the
`X-XSRF-TOKEN` header on `POST`, `PUT`, `PATCH`, and `DELETE`. Safe methods are exempt, matching the
backend. It is done inside the client rather than at each call site so no endpoint can forget.

A freshly loaded page has no token cookie yet and its first request is usually a POST, which the backend
would reject. `GET /api/auth/csrf` returns 204 and sets the cookie; `features/auth/api/authApi.ts` calls
it before register and login.

When the cookie is missing, the request still goes out without the header and the backend answers `403
FORBIDDEN`. That is deliberate: failing early in the client would turn a server-side rule into a
client-side one and produce an error that does not match the contract.

### Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` | Public | Creates an account. 201, no session — the client logs in afterwards. |
| `POST /api/auth/login` | Public | Verifies credentials, sets the session cookie, returns the user. |
| `GET /api/auth/csrf` | Public | 204, sets the CSRF cookie. |
| **`GET /api/me`** | Required | **Canonical identity read.** The user the session belongs to, or 401. |
| `GET /api/auth/me` | Required | Compatible alias for the above. Same body, same backend method. |
| `POST /api/auth/logout` | Required | Invalidates the session. 204. |

Every endpoint that returns a user answers with the same shape, so the object cached after login is the
object re-fetched after a reload.

`GET /api/me` is the canonical path and the one `authApi.ts` calls. `/api/auth/me` remains because it
shipped first; both routes delegate to one `CurrentUserResolver`, so they cannot drift. Prefer `/api/me`
in new code — identity is something the whole application asks about, not a detail of the sign-in flow.

Everything not in the public rows above requires a session, including any product endpoint added later.
A new route is private until someone opens it deliberately in `SecurityConfiguration`.

### Restoring the session after a refresh

The page keeps nothing across a reload; the browser keeps the cookie. `useCurrentUser()` queries
`['auth', 'me']` on mount, and the server answers from the session.

`401` is treated as **data, not an error**: the query maps it to `null`. That keeps `isError` meaningful
for genuine problems such as an unreachable backend. Collapsing the two would leave the UI unable to
tell "please log in" from "something is broken".

```ts
const { data: user, error, isPending } = useCurrentUser();
// user === null        -> no session, show the login link
// user !== null        -> signed in
// error !== null       -> the request itself failed
```

A successful login seeds `['auth', 'me']` from the response, avoiding a second round trip for data the
login call already returned. What is cached is public metadata only — id, email, display name, status.
The password is never stored in state or cache, and the session id is not readable.

### Protected routes

`RequireAuthenticatedUser` is the layout element for `/app`, so every nested route sits behind it. It has
three outcomes, and the last two are deliberately different:

| Query state | Renders |
| --- | --- |
| Pending | A status line only. `<Outlet />` is not mounted. |
| `null` (no session) | `<Navigate to="/login" replace />` |
| Error | The error. **No redirect.** |

Nothing protected renders while the check is in flight. Because identity lives in a cookie the page
cannot read, the answer takes a round trip, and rendering the shell first would flash workspace content
at an anonymous visitor and then remove it. Keeping `<Outlet />` unmounted also stops child routes from
firing their own requests before the user is known.

A failed check is not a signed-out user. If the backend is unreachable, redirecting to a login form that
also cannot reach the backend would hide the real problem, so the guard reports the error and stays put.

### Logout

`POST /api/auth/logout` invalidates the session on the server, which is what actually revokes access —
the browser keeps a cookie that no longer resolves to anything. There is no client-side token to discard.

`useLogout` then calls `queryClient.clear()`. Removing just `['auth', 'me']` would not be enough:
anything fetched while signed in was fetched *as that user*, and leaving it cached would show one
person's data to whoever signs in next in the same tab. The only other cached entry today is the public
health status, so a refetch is the entire cost. Nothing is written to `localStorage` or
`sessionStorage` on the way out, because nothing was ever kept there.

The button navigates to `/login` only after the server has confirmed and the cache is clear, so the login
page cannot read a stale user. If logout fails, the user stays signed in and sees the error — the session
may well still be valid.

### Local development

The dev server proxies `/api` and `/actuator` to port 8080, so the browser calls its own origin and the
cookies are first-party. `credentialsPolicy.ts` stays `'same-origin'`, which is already correct for a
cookie session under that arrangement. A deployment that splits the origins would need `'include'`,
backend CORS with `allowCredentials=true` and an explicit origin allowlist, and `SameSite=None; Secure`
on the session cookie. Serving both from one origin avoids all of that and is preferred.

### Still a backend concern

Authorization is enforced on the server, per request. The frontend hiding a button is not access control,
and the session cookie carries no roles or permissions for the client to inspect or tamper with.
