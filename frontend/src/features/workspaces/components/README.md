# Workspace screens

## Home and creation (RH-284–RH-285)

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

## Overview (RH-286)

`pages/WorkspaceOverview.tsx` composes documents, sources, members and conversation
summaries from their existing queries. The hero uses the shared role badge and avatar
stack, real name/description and a "Grounded in N sources" sticker. N counts READY
sources, matching the existing shell's grounding indicator; failed/pending requests never
invent a zero count. Loading, empty and error states belong to each collection separately.

Recent documents are copied, sorted by `updatedAt` descending and limited to three;
recent sources are similarly limited to four and retain a status word plus icon. Links
open the existing detail routes. Document revision and source type/timestamps are real
response fields; author, document status and evidence totals are not fabricated.
Recent AI activity displays the first three conversation summaries and their update times.
It reuses `useConversationsQuery`, the infinite-query cache shape used by the editor's
ResearchPanel, and requests no conversation histories or per-item metadata.

The compact `WorkspaceQuestions` form retains the existing all/selected/explicitly-empty
source scope semantics. Its visible scope chip names **sources**, because the question
endpoint retrieves source passages, not document text. Submission navigates to `/ask`
with `{ workspaceQuestion: { question, selectedSourceIds? } }` in router state. The full
form sends that question once through the existing CSRF-aware question transport, then
consumes the state with replacement navigation so refresh does not replay it. Questions
are not placed in URLs. Errors and `StructuredResponse` citation/provenance handling are
unchanged. Stateless questions do not fabricate a saved conversation or activity event.

Reference: `Workspace.pdf` p.1. Continue working, analyses, event tracking, due dates,
suggestion chips, presence text and the hero illustration remain outside this change.

## Members (RH-287)

`MemberList` uses a native semantic table with an avatar, name/email and `RoleBadge`.
An Owner of an active workspace gets an icon-only role menu (Editor, Viewer, Make owner)
and a named remove action. Menu selection uses the existing role mutation and cache
invalidation. Current-role items are marked Current and unavailable for redundant writes;
unfamiliar roles remain visible. The server still decides last-owner restrictions.

Removing opens a modal with neutral wording: "This person will lose access to the
workspace. Their edits and contributions will stay." Keep receives initial focus;
Keep/Escape/Close restore the opener. Successful removal moves focus to the roster because
its old row is no longer a reliable target. Last-owner and other server errors stay visible
inside the confirmation. Pending writes block repeat activation and dismissal.

`AddMemberForm` uses the existing email field and Editor/Viewer choice cards, including
arrow-key selection. Field errors retain the server text and accessible associations;
unknown-account and already-member errors remain request-level alerts. Success clears
the email and refreshes existing workspace/member cache keys. The role-information card
describes supported read/edit/upload/manage/ask capabilities. There is no Joined column,
live presence, invitation, Resend or promise of an email.

References: `Workspace.pdf` p.4 and `Components&states.pdf` p.1.

## Settings and archive (RH-288)

Settings has General/Members sub-navigation. Owner can edit Name and Description in the
General card; Discard restores the most recently server-saved values and clears messages.
Save sends the existing complete metadata PATCH and displays server-normalized values.
Changing a saved draft clears the "Changes saved." announcement. Editor sees read-only
text; Viewer and unfamiliar roles have no Settings destination and direct URLs return to
Overview. Archived Owner/Editor settings remain readable with no editing/archive actions.

The Owner-only archive card opens the shared modal. Cancel receives initial focus and
cancellation restores the opener. The confirmation says "No files or documents will be
deleted." Sources and all document versions stay stored, memberships remain, direct
links remain readable, and content becomes uneditable. It makes no restoration promise.
The final archive action uses ink, as in the reference; the card opener uses danger-soft.
The existing archive mutation updates the detail cache, invalidates the active list and
navigates to `/app/workspaces`. Failures preserve the dialog and exact server message.

Reference: `Search,settings&internal_tools.pdf` p.2. Accent selection, archived-item
browsing and restore remain excluded. These three screens add no runtime dependency,
API endpoint, schema migration or server authorization rule. Their component/page tests
and existing coverage gates enforce at least 80% per affected module.
