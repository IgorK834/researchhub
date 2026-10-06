# Document origins and collaborative snapshots (RH-174/RH-175)

The implementation follows `design-reference/Document_editor.pdf` (content-origin inspector) and
`Review,history&roles.pdf` (named snapshot, comparison and safe restore), using the established editor
and design tokens. No AI detection or percentage of AI authorship is presented.

## Recorded origin

Supported blocks are paragraphs, headings, code blocks, figures and analysis results. Prose blocks
receive a stable UUID `attrs.blockId` on actual editing. Opening or selecting an unchanged legacy
block never rewrites it or claims an author. Splitting/duplicating a block assigns fresh identities;
clipboard HTML never imports another document's identities. Yjs replicates the attributes together
with the content and preserves them through binary recovery. Clipboard insertion is recorded as
`IMPORTED`; later typing is recorded as `HUMAN`. Import is a recorded client action, not a verified
external source identity. Subsequent edits do not erase earlier AI/analysis origins.

The server stores append-only block operations in `document_content_operations` (Flyway V29):
`id`, ordered `sequence`, workspace/document/block, category, actor ID and display-name snapshot,
operation type, originating operation ID, safe metadata, document revision, content hash and time.
Categories are `HUMAN`, `AI_GENERATED`, `AI_REWRITTEN`, `IMPORTED`, `ANALYSIS_DERIVED`.
Hashes deduplicate unchanged blocks, independent of JSON object key order. The first human entry
means tracking started; it does not establish historical authorship. Block identity is not a
character-span ledger, so operations cannot be used to calculate authorship percentages.

AI draft/rewrite approval assigns stable block identities and records the suggestion UUID, actual
accepted citations, model identity and whether a person edited the proposal before acceptance.
Human manual evidence-citation insertion records `HUMAN / CITATION_ADDED` with its source operation,
not AI authorship of the surrounding paragraph. Analysis blocks record the exact analysis ID,
immutable execution ID, output ID and render mode; the existing analysis reference validator
checks workspace ownership and readable saved outputs before commit.

Only trusted application acceptance boundaries can record AI categories; ordinary content saves
cannot submit an AI classification. Origin metadata excludes report/source text, generated prose,
prompts, credentials and executable code. Citation metadata retains exact source/version/chunk,
processing version, content hash, location spans and display title. Operations are committed with
the accepted content and receipt; failed transactions leave neither content nor origin records.
The database also rejects updates/deletes, following the existing immutable history policy.

`GET /api/workspaces/{workspace}/documents/{document}/blocks/{block}/provenance` returns the
latest 200 operations in descending revision/sequence order. Membership and content-read permission
are required; document scope and the block's presence in the current content are checked. Viewers
may inspect origins. There is no public write endpoint for the operation store.

The Provenance context tab follows the editor selection, displays category, actor, time, revision,
source operation and source/analysis links, and handles legacy/unsaved blocks and read errors.
It describes recorded operations and explicitly states their limitation after later editing.

## Immutable snapshots

`POST /api/workspaces/{workspace}/documents/{document}/snapshots` takes
`{ "revision": 12, "name": "Before peer review" }` and returns a version summary (201).
CSRF and editor/owner content-write permission are required. Names are trimmed, nonempty and at
most 120 characters. The expected revision must equal the current committed document revision.
Multiple named snapshots may describe the same revision without replacing one another.

Existing `GET .../versions` and `GET .../versions/{version}` retain their contracts and add
`name`, `actorName`, `stateSha256`, `collaborationEpoch`, `collaborationSequence`. `createdBy`
can be null for `SCHEDULED_SNAPSHOT`, whose actor is System. Stored actor names survive membership
removal. No binary state is exposed by the browser version API.

Every snapshot captures materialized editor JSON. When a durable collaboration binary exists,
the same locked transaction also captures its exact bytes, SHA-256 checksum, epoch and sequence.
Collaboration writes store candidate bytes before creating the version in their transaction, so
binary and materialized content represent the same committed state. Checksum mismatch rejects
snapshot creation. Existing versions remain immutable.

The scheduler checks up to 100 candidates each minute and snapshots only active changed documents
whose latest checkpoint is at least ten minutes old. Each snapshot uses a separate transaction and
rechecks under the document lock. No human membership is fabricated for the system actor.
Configuration (defaults):

- `DOCUMENT_SNAPSHOT_SCHEDULER_ENABLED=true`
- `DOCUMENT_SNAPSHOT_FIXED_DELAY=PT1M`
- `researchhub.documents.history.autosave-checkpoint-interval=PT10M`

The History tab provides a named snapshot form, actor/time/reason, comparison and explicit restore
confirmation. Snapshot/restore controls wait for durable saving and are absent for viewers.

## Restore and replicas

The existing restore endpoint creates a new revision with the selected materialized content and
the current document title. It never removes a later version. If the current revision has no
snapshot, it first records a `Before restore` snapshot, so even recent unsnapshotted edits remain
recoverable. Source/analysis references are validated, and all operations are atomic.

Restore increments the collaboration epoch, clears the current mutable CRDT state/receipt and
seeds a new room from the restored materialized content. Historical binary snapshots remain
available internally. This creates a fresh current CRDT rather than merging obsolete updates into
a historical Yjs state. Credentials issued before initial room loading are retired too. Legacy
documents which never requested realtime access remain on the existing REST editing path.

Epoch zero retains `document:<id>`; subsequent rooms are `document:<id>:<epoch>`. Every authorization
and write verifies the credential's current epoch under the document lock. Old writers receive
409 `COLLABORATION_STATE_REPLACED`; connected peers receive `stateReplaced` and close reason
`STATE_REPLACED`. They become read-only until loading the restored snapshot. Browser IndexedDB is
namespaced by epoch, preserving earlier offline updates separately without replaying them into the
restored document. The restorer remounts its editor into the new room. Offline-buffer recovery into
the new state is not automatic; users can keep the previous local data without corrupting history.

## Verification

The document module has a Maven/JaCoCo 80% line gate. Frontend provenance and history have 80%
line/statement/function/branch gates. Tests cover real HTTP/PostgreSQL migrations, immutable origin
records, explicit AI draft/rewrite acceptance, exact analysis provenance, names/permissions/CSRF,
system scheduling, historical preservation, stale credential denial and transactional restore
rollback. Editor tests cover identity stability, formatting, clipboard import and Yjs recovery.

`COLLABORATION_BROWSER_TESTS=true ./mvnw verify` additionally runs two isolated Chrome sessions
against Spring/Testcontainers and the real Node transport: named collaborative snapshot, origin
source links, safe restore, retained history and an offline peer reconnecting into the new epoch.
No product database is used. Build `frontend` with `npm run build:realtime` and `collaboration` with
`npm run build` first. Run `npm run test:coverage -- --runInBand`, `npm run lint` and production
Webpack build in `frontend`; `npm test` in `collaboration` needs local HTTP/WebSocket binding.

Verified on 2026-10-06:

| Component | Result | Coverage |
| --- | --- | --- |
| Backend `COLLABORATION_BROWSER_TESTS=true ./mvnw verify` | 767 tests, zero failures/errors; 4 optional Docker sandbox tests skipped | Document module 99.20% lines / 85.48% branches |
| Frontend `npm run test:coverage -- --runInBand` | 998 tests in 103 suites passed | Provenance 100% lines / 93.02% branches; history 97.82% lines / 97.91% branches |
| Collaboration `npm test` | 27 tests passed | 100% lines / 95.01% branches |
| Builds and static checks | Maven verify, Node TypeScript build, default and realtime Webpack builds, frontend lint/format checks passed | Existing Webpack bundle-size warnings remain |

The Chrome run writes `backend/target/document-browser-provenance.png` and
`document-browser-restored-history.png`; both were inspected against the reference layout.
Optional skipped tests execute the external untrusted-code Docker sandbox, outside this workstream.
