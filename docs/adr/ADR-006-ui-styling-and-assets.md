# ADR-006: UI styling and asset contract

- Status: Accepted
- Date: 2026-10-01
- Tasks: RH-264 (Task 3.7), RH-265, RH-266, RH-267

## Context

Section 37 of [context.md](../context.md) left the UI component library open. The existing
React/TypeScript frontend uses Webpack and Babel, native controls and Jest. The raster
design specifies its own colors, typography, geometry and accessibility rules. A stable
styling and asset contract is needed before implementing feature screens.

## Decision

Build shared primitives with React and native HTML, using plain CSS custom properties.
Adopt no third-party component library. Global `src/styles/index.css`, imported once by
`src/index.tsx`, assembles fonts, light-mode tokens, element styles and utilities. Component
styles are colocated `*.module.css` files with default-exported class maps and unchanged
class-key spelling (including hyphens). Other `.css`
files are global, imported for side effects. Scope CSS by class, keep raw colors in
`styles/tokens.css` and consume semantic roles rather than accent fills for text.

Webpack explicitly separates the two CSS modes. Existing `style-loader` and `css-loader`
handle both development and production. Fonts and SVG files use `asset/resource`, emitted
to `/assets/[name].[contenthash][ext]`. A `.svg` import is a URL string, not a React
component. Inline functional icons come from the typed ResearchHub icon registry.
`env.d.ts` declares these public contracts; TypeScript checks side-effect imports and
`npm run build` continues to run `tsc --noEmit` first.

Jest maps global CSS to an empty module, scoped CSS to class-name proxies and assets to a
URL double. Component tests exercise markup and behavior; they cannot verify layout.
Contract tests compile actual CSS/font/SVG imports with the production and development
Webpack configuration. ESLint's CSS plugin validates authored styles, with unknown
cross-file variables permitted; tests independently reject undefined variable references.
Prettier formats CSS, SVG, TypeScript and configuration files.

## Alternatives

- **A component library (e.g. MUI or an equivalent full kit):** introduces a second visual
  system and substantial overrides to reproduce the reference. Rejected for this scope.
- **Headless component primitives:** useful for future complex interaction patterns, but
  unnecessary for native buttons. Reconsider separately when those patterns are implemented.
- **CSS-in-JS:** adds runtime/tooling coupling and another token representation. Rejected.
- **Utility CSS framework:** adds generation configuration and a competing naming system
  for this small foundation. Rejected.
- **Global CSS for every component:** simpler initially, but prone to feature selector
  collisions. Restrict it to the explicit global entry and utilities.
- **CSS extraction / SVG-to-component transforms:** possible future optimizations; neither
  is needed for the current bundle or the explicit SVG-as-URL contract.

## Dependency consequences

Keep Webpack/Babel, Jest, ESLint 9 and Prettier; use the existing CSS loaders. Add exact
versions of `@fontsource-variable/plus-jakarta-sans` and
`@fontsource-variable/source-serif-4` (both 5.3.0, OFL-1.1) to self-host the named faces.
Add `lucide-react` 1.49.0 (ISC, with Feather-derived MIT artwork) for an explicit selection
of 80 icons. This is an artwork dependency, not a UI component framework; ResearchHub
owns their accessibility and 24-unit / 1.75-unit rounded stroke contract.

Add development dependencies `@eslint/css` 2.0.0, `postcss` 8.5.28 and `@types/node`
26.6.2 for CSS validation and native toolchain contract tests. All additions and their
transitive versions are pinned by `frontend/package-lock.json`. Source/license notices
are in [THIRD_PARTY_NOTICES.md](../../frontend/THIRD_PARTY_NOTICES.md) and copied by
Webpack into `dist/THIRD_PARTY_NOTICES.txt` for redistribution with the emitted assets.

The foundation's executable shared components and icons have explicit 80% gates for
lines, branches, functions and statements; existing feature gates stay intact. CSS has
no executable statement coverage, so token completeness, contrast and motion are
validated as contracts and layout is checked in a browser.

## Consequences and boundaries

The light token contract and native controls become the common foundation. Source hues,
the measured mid-tints and inferred shadow/motion details are distinguished in the
[style documentation](../../frontend/src/styles/README.md). The original muted swatch
fails 4.5:1 on muted surfaces; `--color-text-subtle` is the safe small-text role on all
neutral surfaces. Brand inks are paired with their own tints/mid-tints, never bases.

The login screen demonstrates migration to `Button`; feature migrations remain separate.
No theme switching, dark token map, illustrations, unnamed font faces, backend changes,
schema/runtime services or infrastructure are introduced. Server workspace authorization,
the modular monolith and Python/Java boundaries remain as documented in the architecture.
