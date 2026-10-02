# Workspace home and creation (RH-284–RH-285)

Visual references: `design-reference/Access&home.pdf` pp.3–5 and
`design-reference/Key_user_flows.pdf` p.1, with role colors from
`Components&states.pdf` p.1 and the access rules in `Brand&system.pdf` p.3.

`WorkspaceListPage` renders in the authenticated shell at `/app` and `/app/workspaces`.
It uses the shell's resolved `AppOutletContext.user` for its greeting and the existing
workspace collection query for the grid. The API's newest-created-first order is retained.
There is no query for each card. Loading announces the existing status message and uses
decorative skeleton cards; request failures use the shared error banner rather than the
first-run empty state. An empty successful list shows the design's title, sentence, create
action and three numbered onboarding cards.

`WorkspaceCard` renders a name link, optional description, shared role badge and a native
`time` element whose `dateTime` retains the server timestamp. Visible dates use the user's
locale. Cards have radius 16, a 1 px border and elevation e0, with four columns on wide
desktop windows and two at 1280 px and below. The preview branch accepts only draft name
and description, uses the same card chrome and shows "You · Owner"; it has no link or
invented timestamp. Long names and descriptions wrap within the card.

`CreateWorkspaceDialogProvider` mounts once in `AppLayoutPage`. Consumers call
`useCreateWorkspaceDialog().openCreateWorkspace(event.currentTarget)` from the top-bar,
sidebar or first-run action. The shared 780 px dialog owns modal semantics, focus trapping,
Escape and return-focus. Name receives initial focus. Cancel, Close or Escape discard the
draft. If successful creation removes the first-run opener, focus falls back to the stable
top-bar New workspace action.

`CreateWorkspaceForm` owns only the draft and mutation. Name and optional Description
retain their existing accessible labels and ids. The live preview trims its displayed
draft values; the request still sends the original `{ name, description }` contract and
the server normalizes and validates it. Shared fields display `ProblemDetail.errors`
verbatim with `aria-invalid` and the existing error ids. Description associates both its
optional hint and any error. Unattributed failures remain form-level alerts. Client limits
do not duplicate backend constraints.

Submission uses the existing CSRF-aware client and creation mutation. The button keeps
its width, announces "Creating…" and prevents duplicate activation while pending.
Creation awaits the workspace collection's invalidation/refetch before closing, so the
server-returned workspace appears in the grid and switcher without a full reload. The
current page is retained, preserving the existing creation behavior and return-focus
contract. Creating from another workspace does not change that workspace's context.

No accent/icon pickers, member invitations, card counts/avatars, cross-workspace digest,
activity, illustrations or new transport/schema/runtime dependencies are introduced.
Workspace roles continue to be enforced by the server.

The home and shell component tests cover all three openers, live preview, draft cancellation,
focus restoration, unchanged field/general errors, pending duplicate prevention, success
refetch, greeting, loading, first-run and populated states, unknown roles and collection-only
requests. Jest enforces at least 80% in statements, branches, functions and lines for each
home/card/form/dialog module and for the shared role helper and badge.
