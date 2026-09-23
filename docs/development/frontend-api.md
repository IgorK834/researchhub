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

For a write scoped to one document, invalidate `queryKeys.document(workspaceId, documentId)`
rather than `queryKeys.documents(workspaceId)`.

## Where feature code goes

```text
features/workspace/api/useWorkspacesQuery.ts   hook: useQuery + queryKeys.workspaces()
features/workspace/api/workspaceApi.ts          transport: apiClient.get('/api/workspaces')
pages/WorkspaceListPage.tsx                     renders the hook's states
```

The transport function names the endpoint and its types; the hook binds it to a query key; the page
renders loading, error, and success. Feature folders are created when the first file needs them.

## Current scaffolding

`shared/components/ApiStatusBanner.tsx` is the smoke test for all of the above: it calls
`getHealth()` through the shared client via `useHealthQuery`, renders the loading, error, and
success branches, and invalidates `['health']` on demand. It is wiring proof, not a product
feature, and should be removed once real workspace data is fetched.

## Authentication, later

`credentialsPolicy.ts` is `'same-origin'`. There is no authentication yet — the backend has no
Spring Security on the classpath.

When the `auth` module lands:

- A cookie session needs `'include'`, plus a backend CORS configuration that allows credentials —
  unless the frontend is served from the API's origin or proxied to it, in which case
  `'same-origin'` stays correct.
- A bearer token needs no change there; it belongs in a request header, which the client's
  `headers` option already supports.

Authorization stays a backend concern. The frontend hiding a button is not access control.
