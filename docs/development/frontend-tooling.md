# Frontend tooling

Checks that run the same way on a developer machine and in CI, and the reasoning behind the tool
choices. Layout: [frontend-structure.md](frontend-structure.md). API layer:
[frontend-api.md](frontend-api.md).

## Commands

From `frontend/`:

| Command                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `npm run typecheck`     | `tsc --noEmit`. Type correctness.                         |
| `npm run lint`          | `eslint . --max-warnings 0`. Code smells and React rules. |
| `npm run format:check`  | `prettier --check .`. Fails on unformatted files.         |
| `npm run format`        | `prettier --write .`. Fixes formatting.                   |
| `npm test`              | `jest --ci`. Unit tests.                                  |
| `npm run test:coverage` | `jest --ci --coverage`.                                   |
| `npm run build`         | `npm run typecheck` then `webpack --mode production`.     |
| `npm start`             | `webpack serve` on port 3000.                             |

All of them are non-interactive and exit non-zero on failure. No watch mode, no prompts.

A CI job needs:

```bash
cd frontend
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run build` runs `typecheck` again on purpose: the production build must not be able to
succeed with type errors, whatever else the pipeline does or skips.

## Division of labour

Two tools, no overlap:

- **TypeScript** (`tsc`) owns types. It is the only thing that understands the type graph.
- **ESLint** owns everything types cannot express: unused React hook dependencies, `==` vs `===`,
  accidental `var`, stray `console.log`.

`no-unused-vars` and `no-undef` are switched **off** in ESLint. TypeScript reports both with far
better precision, and the ESLint versions produce false positives on valid TypeScript such as
type-only imports and TSX generics.

## Why not typescript-eslint

`typescript-eslint` is the usual choice and is deliberately not used here.

This project is on TypeScript 7, the native (Go) compiler. Its npm package no longer exports the
legacy JavaScript compiler API — the package entry point exposes only version constants, and the
remaining surface sits behind `typescript/unstable/*`. `typescript-eslint`'s parser is built on that
removed API, so it cannot run on this baseline at all. Its published peer range (`typescript <6.1`)
says the same thing.

The parser is `@babel/eslint-parser` instead, reusing `babel.config.cjs`. Two consequences worth
being explicit about:

- **Good:** ESLint parses exactly what Webpack compiles. There is no second TypeScript program with
  its own `include` list to drift out of sync, and no `parserOptions.project` to maintain.
- **Cost:** no type-aware lint rules. Rules like `no-floating-promises` or
  `no-unnecessary-condition` need type information and are unavailable. `tsc --noEmit` in strict
  mode covers the category of bug those rules target, but not identically.

Revisit this when `typescript-eslint` supports the TypeScript 7 API.

## Babel configuration

`babel.config.cjs` is shared by Webpack and ESLint. One detail matters:

```js
overrides: [{ test: /\.(jsx|tsx)$/, presets: [['@babel/preset-react', ...]] }]
```

`@babel/preset-react` is scoped to `.jsx`/`.tsx`. Applying it to plain `.ts` enables the JSX syntax
plugin there, and a generic arrow function then fails to parse:

```ts
// In a .ts file with the JSX plugin active, <TResponse> parses as a JSX element.
get: <TResponse>(path: string) => request<TResponse>("GET", path);
```

`@babel/preset-typescript` enables TSX support from the file extension, so `.tsx` still works.

## Formatting

**Prettier owns formatting. ESLint does not.**

`eslint-config-prettier` is last in the flat config and switches off every stylistic rule that
would otherwise disagree with Prettier. Formatting arguments are settled by
`frontend/.prettierrc.json`, not by review comments.

Settings: 90-column print width, 2-space indent, single quotes, semicolons, trailing commas, LF
line endings. The indent and line endings match the repository `.editorconfig` (2-space for
`ts`/`tsx`/`js`/`jsx`/`json`, LF everywhere).

Formatting is checked in CI (`format:check`) but never auto-fixed there. Run `npm run format`
locally, or enable format-on-save with the Prettier editor plugin.

## Tests

Jest with `babel-jest`, which reuses `babel.config.cjs`.

**Vitest was rejected**: it would pull Vite into the toolchain, and this project intentionally does
not use Vite ([context.md](../context.md) section 5.2). Adding it as a test-only dependency would
still put a second bundler in `node_modules` and in every contributor's mental model.

Current scope:

- `shared/api` — the `ProblemDetail` decoder, `ApiError`, and base-URL resolution, tested against
  the exact bodies in [api-errors.md](api-errors.md), so drift between the documented contract and
  the frontend's decoding shows up as a test failure.
- `shared/components/ApiStatusBanner` — the smoke query's loading, success, and error branches.
- `shared/components/Button` and `icons` — native action/link behavior, busy and disabled
  states, accessible names, the complete 80-icon registry and compile-only invalid prop checks.
- `shared/components/forms` — label/hint/error associations, native controls, radio group
  arrow navigation and the migrated auth/workspace integrations.
- `shared/components/identity` — mandatory badge words/icons, all avatar sizes, deterministic
  Unicode initials/colors, removal actions and labelled stack overflow.
- `shared/components/overlays` — focus traps/return focus, inertness and scroll restoration,
  nested overlays, popup dismissal and menu keyboard navigation/typeahead.
- `shared/components/feedback` — announcement roles, visible status words, progress values,
  known skeleton content, toast actions and timer pause/expiry behavior.
- `styles` — token completeness, contrast and reduced motion, plus real Webpack asset and
  class-map exports in both modes.

`testEnvironment` defaults to `node`. Component tests opt into jsdom per file with a docblock, which
keeps the fast node environment as the default:

```ts
/**
 * @jest-environment jsdom
 */
```

jsdom does not implement the Fetch API response classes, so component tests stub `fetch` with a
minimal response double rather than constructing a real `Response`.

Coverage collection includes shared components, icons and hooks alongside the API and feature
modules. Shared UI has enforced 80% statement/line/function/branch gates, including separate
Button, icon, form, identity, overlay and feedback gates. Existing source, analysis, AI and citation thresholds are retained.
Run `npm run test:coverage` for the enforced checks.

## Styles and assets (RH-264–RH-267)

[ADR-006](../adr/ADR-006-ui-styling-and-assets.md) selects custom properties and hand-built
native primitives. Global CSS is imported once from `src/styles/index.css`. Colocated
`*.module.css` files export class maps; other CSS imports are side effects. Webpack serves
font and SVG imports as hashed URLs under `/assets/`, including on nested routes.
SVG imports do not generate React components.

The `@eslint/css` plugin checks `src/**/*.css`. It permits references to cross-file tokens;
the style contract tests verify that every referenced variable exists. Prettier checks CSS,
SVG and the new TypeScript/configuration files through the existing commands.
TypeScript declarations cover both CSS modes and font/SVG URL imports, with side-effect
import checking enabled. Build still runs the type checker before Webpack.

Jest's CSS Modules proxy preserves class names, global CSS is a side-effect double, and
assets resolve to a URL double. Component tests check real button/link behavior and icon
semantics, including the login integration. Styles are not laid out by jsdom. Independent
tests check token completeness/contrast/reduced motion and invoke the actual Webpack CLI
in both build modes with CSS and font/SVG imports. Native Node subprocesses keep Babel 8
outside Jest's module VM. Compile-only `Button.typecheck.tsx` checks reject unnamed
icon-only actions and unknown icon names.

Public token roles and safe color pairings: [styles/README.md](../../frontend/src/styles/README.md).
Icon names/artwork mapping and accessibility: [icons/README.md](../../frontend/src/shared/components/icons/README.md).
Font/artwork notices: [THIRD_PARTY_NOTICES.md](../../frontend/THIRD_PARTY_NOTICES.md).

### Browser verification

RH-264–RH-267 were checked on 2026-10-01 in headless Chromium against a production build
and a temporary gallery importing the actual Button/Icon/style sources. The gallery is
verification scaffolding, not an application route. Checks covered every variant's
default/hover/disabled appearance, exact 34/36/44 px heights, 2 px outline with 2 px gap,
text-field sky halo, stable busy width, blocked repeated activation and reduced motion.
All 80 icons at 14 and 20 px stayed inside the 24-unit viewBox including their stroke,
and inherited the parent color. The font requests used only the application origin,
including Latin Extended for Polish text and the serif title face.

The actual `/login` production route was exercised through its transport with deterministic
HTTP responses: a delayed 401 exposed a disabled, named, constant-width busy action and
then the existing generic credential error. `/register` also loaded with the base font.
No live authentication backend was needed or changed by this UI verification.

Final automated result: 423 tests across 43 suites passed; Button and icons have 100%
statement/branch/function/line coverage with the 80% gates enforced. Production build,
TypeScript, ESLint and Prettier pass. Webpack still reports its bundle-size performance
warning; code splitting remains separate from this styling/asset foundation.

### Shared primitives (RH-268–RH-271)

The [shared component contracts](../../frontend/src/shared/components/README.md) describe
the public APIs and their design references. FormField's feature-local markup is replaced
by the shared fields; auth and workspace accessible labels/error ids remain stable, and
ProblemDetail messages are rendered unchanged. ApiStatusBanner uses the shared Banner
without changing its status/polite semantics. AppProviders installs the global toast host.
No dependency, backend, schema, invitation, notification-center or specific-dialog changes
are needed for these primitives.

The production sources were exercised in a temporary gallery and the actual `/login`,
`/register` and `/app/workspaces` routes in Chromium on 2026-10-01–02. Deterministic HTTP
responses verified a server field error in Polish, its described-by association, a successful
workspace submission/refetch and the existing login error announcement. The gallery checked
40/44 px fields, 26/22 px badges, all four avatar sizes, +N overflow, checkbox/switch Space,
radio arrows/disabled skipping, menu Enter/arrows/Home/End/Tab/Escape, nested dialog/menu
focus restoration, inertness, viewport-clamped popovers, toast actions and reduced motion.
The 420 px slide-over was also checked at 1280 px and at a 390 px mobile viewport without
horizontal overflow. Screenshots were compared with the referenced PDF pages. Browser QA
caught and corrected popup Tab dismissal and clipping of focus rings in scrollable dialog
content; jsdom regression tests cover the popup boundary.

The final integration pass also verified live toast regions/actions inside an open modal,
including the dialog's tab trap. A stable portal root follows the active modal and returns
to the body without resetting toast state or lifetime. Component tests cover nested modal
lifetimes, parent unmount and fallback from outside/hidden/disabled initial focus targets.

Each of the four modules has an independent 80% statement/branch/function/line gate.
`Primitives.typecheck.tsx` also checks rejected unlabelled fields/badges/spinners/dialogs,
unknown explicit radio values, photo avatars, interactive notes and blocking toasts with
no action. jsdom verifies behavior; the browser verification checks actual CSS geometry.

Final RH-268–RH-271 verification: **493 tests in 47 suites pass**. Lines and functions
are 100% in all four new modules. Statements/branches are 100%/100% for forms and identity,
100%/99% for feedback, and 98.13%/93.22% for overlays. Existing coverage thresholds remain
unchanged. ESLint, Prettier, TypeScript and production Webpack build pass; Webpack retains
three performance warnings for the approximately 996 KiB main bundle.

### Content, navigation and authenticated shell (RH-272–RH-274)

The new content, navigation and shell directories, plus `pages/AppLayoutPage.tsx`, have
independent 80% statement, branch, function and line gates. Existing thresholds are
preserved. Component tests cover native table/header semantics, selection words, all six
reference empty states, two-action limits, decorative tiles, keyboard-accessible hover
commands, tabs with disabled skipping/wrap/Home/End, pressed filter chips and labelled
breadcrumbs. `ContentNavigation.typecheck.tsx` rejects a third empty-state action, unknown
explicit tab values and columns that read a property absent from their row type.

Shell integration tests exercise all existing protected route shapes, real query hooks,
ready-source counts, role/archived-state action absence, workspace switching, failed and
pending collections, retry, asynchronously available fragment targets and repeated focus
navigation. A regression test verifies that an unsaved outlet draft is not remounted when
workspace metadata arrives or authorization fails on refresh. The migrated dataset-preview
column and sample tables retain their existing feature tests and provenance metadata.

Browser validation uses the production Webpack bundles in Chromium with deterministic HTTP
responses conforming to the existing contracts. A temporary gallery checks actual CSS and
keyboard behavior; production routes check the frame, section actions, list counts, workspace
switching, source dataset tables, document editor and session logout/guard behavior. This
uses no new project dependency or permanent development route. Layout is compared with the
referenced PDF pages at desktop width; responsive shell work remains outside this task.

Final RH-272–RH-274 verification (2026-10-02): **528 tests in 51 suites pass**. Content,
navigation and the presentational shell reach 100% statements, branches, functions and
lines. AppLayoutPage reaches 100% statements/functions/lines and 99.21% branches. TypeScript,
ESLint, Prettier, existing feature tests and the production build pass. Chromium checks
cover all five authenticated route shapes, native table headers and scrolling, keyboard
navigation, hover/focus commands, 264/56 px frame geometry, count/role/roster data, fragment
focus, retained drafts, viewer action absence, workspace selection, logout and guarded
reload. Webpack retains its three performance warnings for the approximately 1.02 MiB
main bundle; code splitting remains separate work.

### Workspace routes, tool layout and desktop breakpoint (RH-275–RH-277)

Verification on 2026-10-02: **567 tests in 55 suites pass**, including all existing workspace,
auth, source/version, dataset/citation, autosave and editor-flow tests. Existing workspace-page
assertions now select their corresponding section rather than mounting every feature at once.
Route tests exercise the exported app route tree, direct section URLs, all six sidebar links,
unknown sections, legacy analysis/heading redirects and unchanged citation query strings.
New component tests cover rail/secondary/main/panel order, dock/slide-over modes, pinned
footer placement, Tab containment, Escape/focus return, DOM/draft preservation across resize,
filter-control state and explicit column priority. Coverage thresholds were extended, not lowered.

| Affected module                              | Statements | Branches | Functions | Lines  |
| -------------------------------------------- | ---------- | -------- | --------- | ------ |
| AppRouter / workspaceRoutes                  | 100%       | 100%     | 100%      | 100%   |
| WorkspaceDetailPage / SourceRoutePage        | 100%       | 100%     | 100%      | 100%   |
| AppLayoutPage                                | 100%       | 97.61%   | 100%      | 100%   |
| DocumentDetailPage                           | 93.10%     | 87.87%   | 90%       | 92.85% |
| ToolShell / ResponsiveFilters / tableColumns | 100%       | 100%     | 100%      | 100%   |
| useNarrowDesktop                             | 90%        | 100%     | 83.33%    | 100%   |

`npm run build` (including strict type-checking), `npm run lint` and `npm run format:check`
pass. The build reports three Webpack performance warnings for the approximately 1.05 MiB
entry bundle; no loader, asset, compiler or runtime errors were found. No dependency or lockfile
update is required by RH-275–RH-277.

The production build was also checked in Chromium at **1600, 1280 and 1024 px**, using
local deterministic responses matching the existing API contracts. Checks included section
navigation and refresh, legacy analysis/citation/dataset query retention, metadata-column
collapse, source slide-over with a library backdrop on direct refresh, context keyboard/focus
behavior, preserved editor/research/filter drafts, viewer permissions and guarded sign-out/reload.
Measured geometry: 264 px desktop sidebar; 64 px tool/narrow rail; 240 px editor secondary
column (260 px in the shared-slot fixture); 340 px docked context; 420 px slide-over; 56 px
bar. None of these viewports produced horizontal page overflow. Production screenshots were
visually compared with the referenced design pages. Existing feature content remains unchanged
until its redesign tasks; no below-1024 top menu or mobile layout is claimed.

To repeat the browser checks with a running development backend, open `/app/workspaces/:id`
and each of `/documents`, `/sources`, `/ask`, `/members`, `/settings`, then refresh. Open an
existing `/documents/:documentId` and `/sources/:sourceId` deep link, keeping its query string.
Resize from 1600 to 1280 px, open/close the context panel with keyboard, then resize back and
verify its draft. On Sources, check the reduced headers and close its detail slide-over to the
library. The generic filter layout is covered by its component/production-slot fixture because
the existing SourceList does not yet expose filter controls. Browser checks here use test API
responses; they do not claim a live Java/database integration run.
