# Frontend structure

The frontend lives in `frontend/` and is a React + TypeScript app built with Webpack and
Babel (no Vite). This document describes the `src/` layout and where new code should go.

How requests and cached server state work: [frontend-api.md](frontend-api.md). Lint, formatting,
and the CI check commands: [frontend-tooling.md](frontend-tooling.md).

## Layout

```text
frontend/src/
├── index.tsx            Entry point. Creates the React root and renders <App />. Stays thin.
├── env.d.ts             Types for the RESEARCHHUB_* values Webpack injects.
├── app/                 App shell: root component, providers, router setup.
│   ├── App.tsx
│   ├── AppProviders.tsx  QueryClientProvider and future cross-cutting context.
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

Not every folder above exists yet. Create a folder when the first file for that area is
added, not in advance. `shared/utils/` and `styles/` are documented here so the location is
unambiguous once the need arises, but they should stay absent from the tree until then.

`features/auth/` is the first feature module and shows the intended shape:

```text
src/features/auth/
├── api/
│   ├── authApi.ts     transport: calls the shared client, owns the request and response types
│   └── useAuth.ts     hooks: useCurrentUser, useLogin, useRegister
└── components/
    ├── CurrentUserBanner.tsx  used only by this feature
    └── FormField.tsx
```

`pages/LoginPage.tsx` and `pages/RegisterPage.tsx` render those hooks and hold the form state. The split
is the point: transport names the endpoint, the hook binds it to a query key, the page renders loading,
error, and success.

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
