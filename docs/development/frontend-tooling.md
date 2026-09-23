# Frontend tooling

Checks that run the same way on a developer machine and in CI, and the reasoning behind the tool
choices. Layout: [frontend-structure.md](frontend-structure.md). API layer:
[frontend-api.md](frontend-api.md).

## Commands

From `frontend/`:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`. Type correctness. |
| `npm run lint` | `eslint . --max-warnings 0`. Code smells and React rules. |
| `npm run format:check` | `prettier --check .`. Fails on unformatted files. |
| `npm run format` | `prettier --write .`. Fixes formatting. |
| `npm test` | `jest --ci`. Unit tests. |
| `npm run test:coverage` | `jest --ci --coverage`. |
| `npm run build` | `npm run typecheck` then `webpack --mode production`. |
| `npm start` | `webpack serve` on port 3000. |

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
get: <TResponse>(path: string) => request<TResponse>('GET', path);
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

`testEnvironment` defaults to `node`. Component tests opt into jsdom per file with a docblock, which
keeps the fast node environment as the default:

```ts
/**
 * @jest-environment jsdom
 */
```

jsdom does not implement the Fetch API response classes, so component tests stub `fetch` with a
minimal response double rather than constructing a real `Response`.

There is no coverage threshold configured — the backlog's 80% target is not enforced on the frontend
while the test surface is this small.
