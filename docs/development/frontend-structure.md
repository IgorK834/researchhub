# Frontend structure

The frontend lives in `frontend/` and is a React + TypeScript app built with Webpack and
Babel (no Vite). This document describes the `src/` layout and where new code should go.

## Layout

```text
frontend/src/
├── index.tsx           Entry point. Creates the React root and renders <App />. Stays thin.
├── app/                 App shell: root component, providers, router setup.
│   ├── App.tsx
│   └── AppRouter.tsx    (added in RH-032)
├── pages/               Route-level page components (one file per route, roughly).
├── features/            Feature modules (workspace, document, source, auth, ...).
│   └── <feature>/
│       ├── api/         Feature-specific API calls, hooks that use shared/api.
│       ├── components/  Components used only by this feature.
│       └── ...
├── shared/
│   ├── api/             HTTP client and API types, shared across features.
│   ├── components/      Reusable UI with no feature-specific logic.
│   ├── hooks/            Shared hooks with no feature-specific logic.
│   └── utils/            Pure helper functions.
└── styles/               Global CSS, design tokens.
```

Not every folder above exists yet. Create a folder when the first file for that area is
added, not in advance. `features/`, `shared/hooks/`, and `shared/utils/` are documented here
so the location is unambiguous once workspace, document, or source UI work starts, but they
should stay absent from the tree until then.

## Where things go

- **`app/`** — anything about assembling the application shell: the root component,
  context providers (theme, auth session, query client, etc. as they're introduced), and
  the router. Not feature-specific.
- **`pages/`** — the component rendered for a given route. A page composes feature
  components and shared UI; it should hold little logic of its own. Example: `pages/LoginPage.tsx`
  renders the login form from `features/auth/` (once that feature exists).
- **`features/<name>/`** — a vertical slice for one product area (e.g. `features/workspace/`,
  `features/document/`, `features/source/`). Feature code should not import from another
  feature; shared needs go through `shared/`.
- **`shared/api/`** — the HTTP client and request/response types. Once wired to the backend,
  error handling here should branch on the `code` field of the `ProblemDetail` response body
  described in [api-errors.md](api-errors.md).
- **`shared/components/`**, **`shared/hooks/`**, **`shared/utils/`** — code with no ties to a
  specific feature, reusable across the app.
- **`styles/`** — global stylesheets and shared design tokens, as opposed to component-scoped
  CSS colocated with a component.

## Rules

- Don't create empty placeholder folders for areas that have no code yet.
- Don't let `features/` import from `pages/`, or one feature import from another. Shared code
  belongs in `shared/`.
- Keep `src/index.tsx` limited to bootstrapping (`createRoot(...).render(...)`); application
  logic belongs in `app/`.
