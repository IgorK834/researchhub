# Public landing page

`/` serves the public marketing page (`frontend/src/pages/LandingPage.tsx`, feature code in
`frontend/src/features/landing/`). It is static: the only request is the session check
(`useCurrentUser`) that swaps **Log in / Create account** for **Open workspaces** when a session exists.
Log in and Create account use client-side navigation to `/login` and `/register`; the auth layout's logo links
back to `/`.

Everything is built from the shared design system (tokens, `Button`, `Badge`, `Sticker`, `IconTile`, `Tabs`,
`Illustration`). Copy, plans and FAQ live in `landingContent.ts`, so product claims are reviewed in one place.

## Product screenshots

The five images in `frontend/src/features/landing/assets/` are real renders of the application against mocked
API fixtures, not mock-ups. Regenerate them after a visible UI change:

```bash
cd frontend
npm start                              # terminal 1
node e2e/landing-screenshots.cjs       # terminal 2; optionally pass names: overview sources ask editor analysis
```

`LANDING_ORIGIN` points the script at another served build. Fixtures are fictional (an electronics lab) and never
touch a product database.

## Pricing

The Free and Premium plans, prices and limits in `landingContent.ts` are **placeholders** until billing exists.
Both calls to action lead to registration; Premium is labelled as opening soon.
