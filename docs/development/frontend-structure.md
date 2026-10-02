# Frontend structure

The frontend lives in `frontend/` and is a React + TypeScript app built with Webpack and
Babel (no Vite). This document describes the `src/` layout and where new code should go.

How requests and cached server state work: [frontend-api.md](frontend-api.md). Lint, formatting,
and the CI check commands: [frontend-tooling.md](frontend-tooling.md).

## Layout

```text
frontend/src/
├── index.tsx            Entry point. Creates the React root and renders <App />. Stays thin.
├── env.d.ts             Public build values and CSS/font/SVG import contracts.
├── app/                 App shell: root component, providers, router setup.
│   ├── App.tsx
│   ├── AppProviders.tsx  QueryClientProvider and global ToastProvider.
│   ├── AppRouter.tsx
│   └── queryClient.ts    TanStack Query defaults.
├── pages/               Route-level page components (one file per route, roughly).
├── features/            Feature modules (workspace, document, source, auth, ...).
│   └── <feature>/
│       ├── api/         Feature-specific API calls, hooks that use shared/api.
│       ├── components/  Components used only by this feature.
│       └── ...
├── shared/
│   ├── api/             HTTP client, typed errors, query keys. No React.
│   ├── components/      Reusable UI with no feature-specific logic.
│   ├── hooks/            Shared hooks with no feature-specific logic.
│   └── utils/            Pure helper functions.
└── styles/               Global CSS, design tokens.
```

Create a folder when the first file for that area is added, not in advance. `shared/utils/`
contains the pure workspace-capability and role-label helpers. `styles/` contains the global entry, font imports, tokens, base styles
and utilities; shared Button, icons, forms, identity, overlays, feedback, content, navigation and shell live under
`shared/components/`. See its [public contracts](../../frontend/src/shared/components/README.md) and
[ADR-006](../adr/ADR-006-ui-styling-and-assets.md) for styling and asset conventions.

`features/auth/` is the first feature module and shows the intended shape:

```text
src/features/auth/
├── api/
│   ├── authApi.ts     transport: calls the shared client, owns the request and response types
│   └── useAuth.ts     hooks: useCurrentUser, useLogin, useRegister
└── components/
    ├── AuthLayout.tsx          split public login/register frame and decorative art slot
    ├── CurrentUserBanner.tsx  used only by this feature
    ├── RequireAuthenticatedUser.tsx
    └── LogoutButton.tsx
```

`pages/LoginPage.tsx` and `pages/RegisterPage.tsx` render those hooks and hold the form state. The split
is the point: transport names the endpoint, the hook binds it to a query key, the page renders loading,
error, and success. Auth and workspace form chrome comes from `shared/components/forms`.
The public auth frame and client-only password confirmation are described in the
[authentication screen contract](../../frontend/src/features/auth/components/README.md).

## Where things go

- **`app/`** — anything about assembling the application shell: the root component,
  context providers (theme, auth session, query client, etc. as they're introduced), and
  the router. Not feature-specific.
- **`pages/`** — the component rendered for a given route. A page composes feature
  components and shared UI; it should hold little logic of its own. Example: `pages/LoginPage.tsx`
  renders the login form from `features/auth/` (once that feature exists).
- **`features/<name>/`** — a vertical slice for one product area. The folders that exist are
  `features/auth/`, `features/workspaces/`, `features/documents/`, `features/sources/` (the source library, uploads,
  immutable versions and extraction previews), `features/ai/` and `features/analysis/` (the bounded dataset preview of a
  source version, see [dataset-inspection.md](dataset-inspection.md)); name a new one after the
  collection it serves, matching its query key (`queryKeys.documents`, not `queryKey.document`).
  Feature code should not import from another feature; shared needs go through `shared/`. When a
  screen genuinely needs two features — the document page needs the workspace role to decide what to
  render — the **page** composes them and passes what it learned down as props. That is what pages are
  for, and it keeps either feature usable without the other.
- **`features/documents/autosave/`** — the autosave controller (`documentAutosave.ts`, no React, tested with
  fake timers), its timing (`autosaveTiming.ts`), and the hook that binds it to the editor. A folder of its own
  because it is neither transport nor a component: it is the rule for when a save is sent.
- **`shared/api/`** — the HTTP client, typed errors, and the query-key factory. It contains no
  React, so it can be unit tested without a renderer. Errors branch on the `code` field of the
  `ProblemDetail` body described in [api-errors.md](api-errors.md). Details:
  [frontend-api.md](frontend-api.md).
- **`shared/components/`**, **`shared/hooks/`**, **`shared/utils/`** — code with no ties to a
  specific feature, reusable across the app. React bindings for `shared/api` (query hooks) belong
  in `shared/hooks/`; feature-specific query hooks belong in `features/<name>/api/`.
- **`styles/`** — global stylesheets and shared design tokens, as opposed to component-scoped
  CSS colocated with a component.

## Rules

- Don't create empty placeholder folders for areas that have no code yet.
- Don't let `features/` import from `pages/`, or one feature import from another. Shared code
  belongs in `shared/`.
- Keep `src/index.tsx` limited to bootstrapping (`createRoot(...).render(...)`); application
  logic belongs in `app/`.
- Don't call `fetch` outside `shared/api`. See [frontend-api.md](frontend-api.md).
- Keep server state in TanStack Query and local UI state in React state. Don't push form drafts,
  selection, or modal flags through the query cache.

The authenticated frame (RH-274) is mounted once by `pages/AppLayoutPage.tsx` under the
session guard. Presentational shell, content and navigation primitives live in
`shared/components/shell`, `content` and `navigation`; they import no features. The page
composes existing feature queries and router destinations. `app/AppNavigation.module.css`
styles this app-specific navigation. The previous header's API smoke banner is no longer
part of the frame. No backend, route, schema or runtime dependency is introduced.

Workspace navigation targets the six section routes and existing document/source detail routes. Heading-fragment
navigation focuses the target after data arrives, and the outlet's mount remains stable
while shell metadata loads or fails. Optional `enabled` flags on the existing query hooks
prevent the shell's workspace collection requests before workspace authorization succeeds.
The default remains enabled for existing feature consumers. Counts share list cache keys
and their existing mutation invalidations; no duplicate transport or client permission
model is introduced. See the [public contracts](../../frontend/src/shared/components/README.md)
for slots, keyboard behavior, unknown-count handling and scope exclusions.

RH-275–RH-277 split the workspace page by its typed `section`, using existing feature content.
`app/workspaceRoutes.ts` owns URL construction and compatibility rules; `app/AppRouter.tsx`
exports the route tree and creates one browser router for the app entry, including StrictMode mounts. Legacy analysis queries
and heading fragments are redirected without dropping query selectors. Unknown sections use
NotFoundPage. See the [section/slot contracts](../../frontend/src/shared/components/README.md).

`shared/components/shell/ToolShell.tsx` supplies the secondary/main/context layout; AppShell
still owns the only main landmark and chooses the 64 px rail for tools. At the desktop breakpoint
(<=1280 px), CSS collapses standard sidebars and `shared/hooks/useNarrowDesktop.ts` observes
context/table changes. Stable React portals retain research and filter controls across layout
changes. `pages/SourceRoutePage.tsx` composes the narrow source slide-over with the Sources
backdrop, including direct URLs. The frontend has no new source-reading or filtering transport.

SourceList uses the semantic DataTable; its Uploaded by and Date columns opt into metadata
priority. Dataset, comparison and other tables keep all columns unless their consumers explicitly
mark metadata. No generic behavior guesses priority from translated header text.

RH-278 centralizes UI affordances in `shared/utils/workspaceCapabilities.ts`; workspace,
document and source pages and the shell consume the same role/archive mapping. The server
still authorizes every request. `shared/components/identity/RoleBadge.tsx` adds the design's
Owner, Editor and Viewer presentation while retaining unfamiliar server role strings.

RH-284–RH-285 compose the workspace home and creation flow from feature-owned cards and a
single `CreateWorkspaceDialogProvider` inside the authenticated frame. The shell passes
its resolved user through `app/AppOutletContext.ts`, so the greeting does not fetch another
identity. Sidebar, top-bar and empty-state openers share one dialog. Drafts stay in React;
successful creation waits for the existing workspace query invalidation/refetch before
closing. See the [workspace home contract](../../frontend/src/features/workspaces/components/README.md)
for preview, focus, error and request behavior.
