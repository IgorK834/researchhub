# Authentication screens (RH-283)

`LoginPage` and `RegisterPage` compose `AuthLayout`, shared `TextField`, `Button`, `Badge`
and `Sticker`. The layout follows `design-reference/Access&home.pdf` pp.1–2: a 400 px login
form with a lavender panel on the right; a 420 px registration form with a mint panel on
the left. Panels have a 24 px inset and radius. Registration's panel extends to the
centre inset as in the mirrored reference. Controls are 44 px high. Password and
confirmation sit side by side when space allows. Below 800 px the decorative panel is
hidden; below 480 px the password fields stack. The form remains first in DOM and focus
order in both layouts, with one `main` landmark and a labelled form section.

`AuthLayout` takes a `variant`, `title`, `subtitle`, `children`, `footer` and optional
decorative `art` slot. The art panel is hidden from assistive technology and contains
no controls. There is no illustration yet. All colors and typography use the existing
tokens and fonts served from the app origin; the caption uses Source Serif italic
because the design's handwritten face is unnamed.

The existing headings (`Log in`, `Register`), field labels (`Display name`, `Email`,
`Password`), account prompts, progress copy and server error copy are preserved. The
login account link is now `Create account`, as requested. Google is a native disabled
button described by its visible `Soon` badge, with no handler or provider integration.
Legal wording is text until actual Privacy and Terms destinations exist; it creates
no dead links or new routes. Password reset and strength scoring remain out of scope.

Registration compares the exact password values, including whitespace. A mismatch
appears while confirmation is being entered, on blur, or on submit if confirmation is
missing. Changing either password revalidates it. A mismatch blocks submission before
CSRF priming and focuses confirmation. The message is associated through
`aria-describedby` and `aria-invalid`; it is cleared when values match. Confirmation
is never included in `RegisterInput`. Both passwords clear on success and registration
still returns to `/login` without establishing a session.

Both screens use the existing `useAuth` hooks and shared API client: CSRF priming before
POST, same-origin cookie credentials, no Web Storage credentials, unchanged
`ProblemDetail` field errors, a generic `Invalid email or password.` announcement on
login rejection, and duplicate-email errors beside Email. General errors retain
`role="alert"`. Pending buttons retain their width, expose `aria-busy`, display the
existing progress text and block repeat submissions. No backend contract, route,
schema, runtime dependency or lockfile change is needed for this task.

Tests cover success, unchanged transport and redirects, field/general errors, duplicate
email, retry, mismatch/correction/blur/focus, empty confirmation, progress, repeat
submission, disabled Google and the decorative art slot. Jest enforces at least 80%
statements, branches, functions and lines separately for both pages and `AuthLayout`,
without changing existing coverage thresholds. Run from `frontend/`:

```sh
npm run test:coverage -- --runInBand
npm run lint
npm run format:check
npm run build
```

Browser validation uses the production bundle with deterministic responses to the
existing API contracts. Check both direct public routes at 1440, 1280, 1024 and 390 px,
then follow Create account → mismatched confirmation → matching registration → login
rejection → successful login → reload → sign-out. Verify CSRF headers, absence of a
registration session, cookie-based restoration, keyboard focus and no page overflow.
These fixtures exercise frontend integration; they do not replace backend auth tests.
