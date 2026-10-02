# Document screens (RH-289–RH-291)

References: `Workspace.pdf` p.3, `Document_editor.pdf` p.1,
`Reusable_parts.pdf` p.5 and `Components&states.pdf` p.2.

## Public contracts

- `DocumentList` defaults to a summary table with title search, Last edited / Title / Revision
  sorting, count and Open links. `variant="column"` renders the editor navigation and marks
  `currentDocumentId` using `aria-current="page"`. `canEdit` defaults to false; pages supply
  the shared workspace capability, including archive restrictions. Mutation controls never
  appear for viewers. Hover actions also appear on keyboard focus and remain visible on
  devices without hover. Loading/error counts remain unknown.
- `CreateDocumentDialog` uses the existing create form and shared modal focus management.
  The shell's `#create-document-heading` link opens the same dialog; closing dismisses that
  location key, and a subsequent navigation can open it again. Creation passes the existing
  empty ProseMirror paragraph. The page's `onCreated` callback opens the new document.
- `DocumentRowActions` offers Rename and Archive. Rename fetches the full document because
  summaries have no body, checks that it is readable, and sends the original content and
  fetched revision to the existing PATCH endpoint (`MANUAL`). It preserves provenance
  and does not normalize the body. A concurrent save remains a server-side conflict; a
  failed request retains the draft. Archive confirms, calls the existing DELETE endpoint
  and invalidates the document query. It does not delete the stored text.
- `DocumentEditorForm` still owns its local draft, selection, autosave, manual checkpoints,
  conflicts and restore behavior. Optional `statusHost` and `historyHost` are stable portal
  destinations. `renderAuthoring` receives `DocumentAuthoringContext`; the page mounts the
  existing AI feature in that slot. The document feature no longer imports AuthoringPanel.
- `DocumentBodyEditor.onNavigationChange` reports headings, their ProseMirror positions,
  the current section and stable citation entities from the live tree. `navigationTarget`
  scrolls/focuses a heading through a selection-only transaction. These values are never
  stored. Heading edits, removal, duplicate titles, selection and scrolling update the
  outline. A refetch never calls `setContent` or replaces a draft.
- `DocumentSources` groups citation entities by source. Each citation locator retains its
  immutable source version via page-supplied `citationHref`; uncited sources are authorized
  workspace summaries absent from those entities. No evidence is inferred from text.

The page composes ToolShell, Breadcrumb, AvatarStack and Tabs. Save status, History and
Ask AI mount into the existing top bar through `AppOutletContext.documentTopbarHost`.
Context tabs retain mounted research/authoring drafts. At <=1280px the existing context
slide-over opens from its own trigger or the top-bar buttons and restores opener focus.
The origin legend is a static card at the bottom of the documents column; there are no
per-paragraph bars, outline ticks or presence indicators.

## Paper and content compatibility

`DocumentPaper.module.css` styles a maximum 760px paper, an autosizing Source Serif title,
readable body, headings, lists, quotes, tables with header rows, and inline citation chips.
Toolbar icons retain existing accessible names and pressed states. Quote toggling uses
StarterKit's existing blockquote. Table editing controls appear while in a table.
Links remain disabled; no comment, status, author or template feature is added.

The `figure` / `figureCaption` extensions render semantic containers over existing
block/inline nodes, including citations. They add no upload, chart execution or analysis
transport. Existing document JSON is unchanged; opening or navigating does not save it.
This additive editor schema extension uses the existing `PROSEMIRROR_JSON` format, so no
database migration is needed. Unsupported nodes are still refused rather than silently
emptied. No runtime package or lockfile change is required.

## Save feedback, Viewer and history (RH-292–RH-294)

`SaveStatus` uses the timestamp returned by the last acknowledged save. Background
refetches do not replace it. Failure and conflict banners retain the existing text-safety
copy, retry and explicit discard/load-latest action. No browser persistence is claimed.
The page passes the confirmed Viewer role to `DocumentViewerNotice`, which presents a
Read-only chip, information bar and dismissible informational toast. Editing controls
remain absent; authorization is still enforced by the existing server endpoints.

`DocumentHistory` resolves author names from the page's existing workspace members,
with an explicit Unknown author fallback. Selection previews a stored restore point
against `currentDocument`, the last server response, rather than the editor's draft.
The comparison occupies the paper slot while the original editor stays mounted and
hidden. Closing the preview or leaving the History tab reveals the unchanged draft.
Restore still requires confirmation and the acknowledged revision, and is disabled
with the existing explanation while edits are unsaved. It creates a new revision and
preserves all existing restore points.
History summaries refresh whenever the panel opens or remounts; immutable version bodies
remain cached. This also exposes another writer's restore points after loading the latest
document, within the application's normal cache freshness window.

`compareStoredDocuments` is a pure client-side word diff. Exact nodes anchor a bounded
LCS; compatible containers are compared recursively, retaining list and table structure,
marks, whitespace and citation metadata. A shared cell budget avoids quadratic work on
large changed runs. The React-only preview uses mint additions and coral removals and
announces identical content explicitly. It never sends a transaction to the editor or
changes a stored document. No endpoint, schema, runtime dependency or migration is added.

## Verification

Run `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format:check`
and `npm run build` from `frontend`. Jest enforces at least 80% statements, branches,
functions and lines across `features/documents`, alongside the DocumentDetailPage gate.
SaveStatus, DocumentEditorForm, DocumentHistory, DocumentVersionDiff, DocumentViewerNotice
and the diff algorithm additionally have individual 80% gates for all four metrics.
DocumentList, DocumentFrame, DocumentDetailPage and DocumentWorkspaceFlow cover CRUD,
permissions, content round-trips, autosave, failure/conflict recovery, heading navigation,
version history and context draft retention. Backend DocumentApiIntegrationTest and
DocumentHistoryApiIntegrationTest verify workspace-scoped authorization and persistence.
