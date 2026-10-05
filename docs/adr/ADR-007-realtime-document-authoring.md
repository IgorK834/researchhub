# ADR-007: Yjs authoring with an authorized, durable Hocuspocus transport

- Status: Accepted
- Date: 2026-10-05
- Tasks: RH-160–RH-166 (16.1–16.7)
- Prerequisites inspected: existing Tiptap/ProseMirror editor, JSON persistence, revision conflict detection,
  immutable document versions, session/CSRF authentication and workspace membership guards (6.4/6.5, 5.2, 4.5).

## Context and alternatives

ResearchHub currently saves a whole ProseMirror tree using revision-checked PATCH. That protects against lost
updates but cannot merge simultaneous writing. Design references (`DESIGN_SPEC.md` sections 2.10, 2.11, 4.15,
5.16; `Document_editor.pdf`, `Review,history&roles.pdf`, `Components&states.pdf`) call for a quiet save indicator,
read-only viewers and reconnection that retains local changes. Existing semantic citations, figures and analysis
blocks carry immutable source/execution provenance and must survive synchronization.

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep revision PATCH or add WebSocket notifications | Conflicts still replace whole bodies; no simultaneous authoring | Reject |
| Implement Java CRDT or an OT engine | A second editor protocol and conflict algorithm inside the core domain | Reject |
| Yjs with y-websocket | Sound CRDT; more custom authentication, room lifecycle and acknowledgement work | Viable, not selected |
| Tiptap/ProseMirror + Yjs + Hocuspocus | Existing schema and editor binding; authentication hooks and sync acknowledgements | Select |
| Azure Web PubSub | Managed transport still needs Yjs coordination, authorization and persistence; no current deployment benefit | Defer |

## Decision and ownership

Yjs **is the canonical realtime state** of an activated document, including while its room is unloaded. Tiptap
binds the body to the `default` XmlFragment; a `metadata` Y.Map holds the shared title. Undo/redo uses the Yjs
binding, with StarterKit undo history disabled. The browser never initializes a room from its stale REST copy.
Hocuspocus runs as the independently startable Node/TypeScript package `collaboration/`, not the React dev server.
The selected, pinned Hocuspocus 3.4.3 protocol and Tiptap 3.31.3 remain explicit lockfile dependencies.

Spring stays a modular monolith. Its `collaboration` module uses the public `document.application` boundary,
which owns document locks, JSON validation, reference validators, immutable versions and workspace guards.
The module does not import another module's repository/domain objects. Node has no PostgreSQL credential,
user database, membership cache or AI/Python responsibility. It receives only short-lived authorization decisions
from Spring and transports CRDT updates. One Node instance owns the live rooms in this first deployment.

## Authorization and security boundary

1. The authenticated browser calls the document-scoped credential endpoint through the existing CSRF-protected
   Spring API. Spring checks current edit capability, workspace ownership and document/workspace archival.
2. Spring creates a cryptographically random 256-bit opaque credential with a maximum 120-second TTL. Its database
   row contains only document, workspace, user and expiration; only SHA-256 of the token is stored. The browser
   receives `token`, `document:<id>`, public WS URL, expiry and a minimal verified presence identity in a `Cache-Control: no-store` response.
3. The browser sends this credential in the Hocuspocus authentication frame. No product session/access token or
   collaboration token enters the WS query string. Each reconnect fetches a fresh credential via the session API.
4. Node calls the private Spring authorization endpoint with its separate service secret. Spring resolves the
   token hash and repeats domain authorization. The room must equal `document:<resolved documentId>`. A guessed
   room, a substituted document, an anonymous connection, an expired token or a removed member fails closed.
5. Every incoming room message repeats the Spring decision. Existing connections are rechecked at most every
   5 seconds and disconnected when access expires, membership is removed, role is demoted or a resource is archived.
   During Spring unavailability the same check disconnects; no authorization result is cached indefinitely.

Viewer access uses the existing authorized REST read API and read-only editor. Although Hocuspocus supports a
read-only connection, exposing a second viewer authorization lifecycle is unnecessary for these tasks; viewers
receive no realtime credential. They can refresh to read the latest committed snapshot.

Trust boundaries are browser → Node (untrusted protocol and editor input), browser → Spring (session + CSRF),
and Node → Spring (private stateless service authentication). The narrowly matched Spring security chain disables
CSRF **only** for `/internal/collaboration/**`; a browser cookie cannot authenticate these endpoints. Deployment
must keep this path private, use TLS/WSS outside localhost, restrict origins and distribute a random service secret
of at least 32 characters. Health exposes process health only. Unknown HTTP routes return 404. Incoming payloads
are bounded to 4 MB, titles to 500 characters and editor JSON to the existing 1 MB domain limit. Client stateless
broadcasts are rejected; server persistence notifications are authoritative.

Revocation is intentionally bounded: an already accepted request can complete, and an idle removed session might
receive an update during the recheck interval (plus up to the 5-second backend request timeout). New connections and
new incoming messages never use an old cached membership decision. This release uses revalidation instead of a new
message broker/outbox; stricter immediate outbound revocation needs a subsequent deployment requirement.

## Ephemeral presence and active access changes (RH-165 / RH-166)

Yjs Awareness transports presence separately from the Y.Doc. The only non-null public state fields are
`user: {userId, displayName, colorId}` and optional `cursor: {anchor, head}` (Yjs relative positions).
Spring resolves the name through the public `user.application.UserLookupService`, only after document/workspace
authorization, and emits no email. The generated color identifier uses the same stable FNV-1a palette as existing
avatars. Neither credentials nor document snapshots store presence. The browser shows only connected room users,
deduplicates multiple tabs for one user, hides a one-person roster, and collapses a larger roster to three avatars
plus `+N`. Tiptap CollaborationCaret renders escaped text labels and tinted selections from the fixed brand palette.

Node validates every awareness frame before Hocuspocus applies/broadcasts it: at most 16 KiB and 64 states,
only the explicit fields above, bounded structural relative positions, and identity matching the Spring decision.
The pinned browser provider publishes only its own client updates/removal; this avoids treating Hocuspocus remote
cleanup echoes during disconnect as authorized changes to a peer. One Yjs awareness client ID is bound to one authenticated document connection. Provider echoes with stale/no-op
clocks are permitted; a newer update or removal of another connection's client is rejected. Socket disconnect
removes its awareness immediately; a silently lost connection is detected by the 10-second WebSocket heartbeat
(usually within 20 seconds), with Yjs's 30-second stale-awareness timeout as a fallback. Registry entries are released
on disconnect/unload; restart begins with no presence and reconstructs only durable editor state.

Every message still reauthorizes against Spring. In addition, one non-overlapping check per active session runs
at most every 5 seconds (plus the bounded 5-second private HTTP timeout). EDITOR → VIEWER, member removal,
workspace/document archival or disabled account closes the room with `ACCESS_REVOKED` and sends the authoritative
`{"event":"accessRevoked"}` notification first. The client hides presence, becomes read-only, retains unaccepted
IndexedDB edits and stops automatic reconnect/online retries. It offers an explicit page reload to check access again.
A viewer then uses the authorized REST snapshot; a removed member cannot obtain another credential. No legacy
full-document autosave is enabled when an already active realtime editor loses permission. Credential expiry instead
closes with `ACCESS_EXPIRED` and renews through the session/CSRF endpoint; transient Spring unavailability closes
with `ACCESS_UNAVAILABLE`, fails closed and allows bounded transport reconnection. An accepted request may finish,
and outbound exposure has the bounded recheck window described above; no new broker or membership cache is added.

```mermaid
sequenceDiagram
    participant B as Browser (untrusted)
    participant C as Collaboration (ephemeral)
    participant S as Spring (domain authority)
    B->>S: Session + CSRF: document credential
    S-->>B: Scoped token + verified userId/displayName/colorId
    B->>C: Authenticate; awareness user and relative cursor
    C->>S: Private service credential: reauthorize
    S-->>C: Current editor access + verified identity
    C-->>B: Broadcast validated awareness (no persistence)
    Note over S: Owner changes role/removes member/archives workspace
    C->>S: Periodic recheck or next incoming message
    S-->>C: Denied with 403/404/409
    C-->>B: accessRevoked; close room; remove awareness
    Note over B: Read-only, local buffer retained; no automatic retry
```

Official protocol references: [Yjs Awareness](https://docs.yjs.dev/getting-started/adding-awareness),
[Awareness API](https://docs.yjs.dev/api/about-awareness),
[Tiptap CollaborationCaret](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret).
The pinned implementation is tested against provider echo behavior and the actual Chrome editor, rather than assuming
all awareness frames belong to the sender or contain only local state.

## Persistence, migration and consistent reads

Flyway V25 introduces `collaboration_documents` (document FK, sequence and binary Yjs snapshot) and hashed expiring
`collaboration_credentials`. V26 adds the last snapshot UUID receipt and SHA-256 digest. Existing V25 bytes are preserved; the first locked load computes their digest before Node checks the decoded state and editor projection. Activation and legacy saves lock the same document row. On first load, Spring freezes
revision-based replacement by activating the marker. Node converts the authorized current ProseMirror JSON into Yjs
exactly once, including the title, and commits that seed before synchronization. No bulk rewrite, lost legacy
history or duplicate browser seeding is involved. Failed initialization keeps the original JSON available to readers. Before exposing a room, empty text blocks receive a shared empty `Y.XmlText`.
Otherwise simultaneous first insertions can allocate competing text containers which the ProseMirror binding later
merges, making author-local undo ineffective. The browser prepares newly created empty blocks in a tracked CRDT
transaction grouped with their creator's undo. Existing binary rooms missing these containers receive a versioned
structural repair after integrity validation; they are never seeded again from REST. This changes no semantic text,
provenance or historical reference.

For each actual incoming change, the service serializes processing **per room**, builds a temporary candidate Y.Doc,
validates its editor projection, and sends a full encoded Yjs state plus JSON and title to Spring. In one transaction
Spring reauthorizes, compares the durable sequence, validates domain content/provenance, updates the binary snapshot,
advances the document revision and writes any due autosave checkpoint. Only after commit does Node apply/broadcast
the update to the live room. Hocuspocus then applies it idempotently and sends its normal sync acknowledgement.
Every snapshot request has a fresh UUID `snapshotId`. Spring stores only the last receipt beside the state. An immediate
retry of the same UUID, expected sequence, bytes and projection returns the same revision without a second write or
history entry; a reused identity with altered content fails with 409. Node retries a transient/lost HTTP response once
using the exact request. The per-room queue prevents another local write replacing that receipt during retry.
A `persisted` stateless notification carries the committed revision and server timestamp for the UI.

The hook is deliberately `beforeHandleMessage`: in the selected Hocuspocus version the async `beforeSync` callback
is **not awaited**. A debounced `onStoreDocument` alone would acknowledge edits before durable storage and leave a
crash loss window. Full snapshots per accepted update are chosen over an update journal for the smallest durable
implementation. Their cost is higher bandwidth and a database write per update; no batching/compaction infrastructure
is introduced. Binary state is limited to 4 MB; larger documents fail visibly and retain unsent local edits.

Once activated, legacy PATCH, revision-based AI acceptance and restore are rejected with 409, even when no room is
open or the feature flag is turned off. `revision` still describes a committed materialization/history checkpoint;
it no longer resolves concurrent changes. `Save version` creates an idempotent immutable checkpoint of the committed
projection. Realtime UI disables revision-based AI insertion/restore, avoiding an incompatible replacement route;
research reads, provenance inspection, manual writing and history inspection remain available. CRDT transactions
for historical restore and AI acceptance are separate follow-up workflows, outside RH-160–164.

The existing read API obtains **one committed document row**, whose JSON/title were written atomically with the
binary Yjs snapshot. Export consumers must use that read/materialization and its revision, not an in-memory
`getJSON()` callback in another process. No export endpoint is introduced by these tasks. An export linearizes at
its database read: it includes all changes committed before that read, and excludes currently pending edits. An
"include my latest edit" action must first wait for its provider's durable acknowledgement. History reads use immutable
version rows. A conflicting sequence closes/reconnects the writer instead of overwriting another instance's state.
Multiple independent replicas must not be configured for the same rooms: CAS prevents lost writes but is not a
multi-instance live-room transport or a leader lease.

```mermaid
sequenceDiagram
    participant B as Browser (untrusted)
    participant S as Spring (domain + authorization)
    participant P as PostgreSQL (durable)
    participant H as Node Hocuspocus (transport)
    B->>S: Session + CSRF: document credential
    S->>P: Check workspace/document/membership; hashed credential (<=120s)
    S-->>B: Opaque token + canonical room + WS URL
    B->>H: WS auth frame (no query token)
    H->>S: Private service token: authorize token + room
    S->>P: Resolve scope; recheck edit capability
    S-->>H: Scoped access + expiry
    H->>S: Authorized load/activate
    S->>P: Lock document; activate realtime; read binary/JSON
    S-->>H: Binary snapshot or legacy JSON seed
    opt Initial room
        H->>S: Persist server-created Yjs seed + projection
        S->>P: Atomic binary + JSON + revision
    end
    H-->>B: Yjs synchronization
    B->>H: Yjs edit update
    H->>S: Reauthorize; candidate snapshot + JSON + expected sequence
    S->>P: Transaction: compare sequence, validate, persist + checkpoint
    P-->>S: Commit
    S-->>H: Committed sequence/revision/time
    H-->>B: Broadcast update + durable acknowledgement
    Note over H,S: Every message + periodic <=5s session revalidation
    B-xH: Network loss / process crash
    Note over B: IndexedDB keeps local Yjs updates
    B->>S: Fresh scoped credential via session + CSRF
    B->>H: Reconnect with new credential
    H->>S: Authorize and load latest committed binary
    S->>P: Read snapshot
    H-->>B: State-vector sync; merge pending authorized updates
    B->>H: Resend missing updates (idempotent)
    H->>S: Commit before broadcast/acknowledgement
```

## Recovery and operational limits

- Node dies before commit: no acknowledgement; IndexedDB retains the client update and reconnect resends it.
- Node dies after commit but before broadcast/ack: the next room loads the committed binary. Resends are Yjs-idempotent.
- Spring/PostgreSQL is unavailable or rejects validation: candidate is discarded, peers never see it, originating
  connection closes and unsent state remains local. The UI does not claim the failed edit is saved.
- Response is lost after a successful commit: the bounded identical-receipt retry returns that commit. If the retry
  also fails, reconnect loads the committed binary; Yjs resends are idempotent and CAS never blindly overwrites state.
- Browser refresh/crash: `y-indexeddb` restores local Yjs state before connection. Normal unmount closes transport;
  closing the tab with pending updates triggers the existing browser leave warning. Local storage is not a backup:
  users clearing site data or losing their device can lose **unacknowledged** edits.
- Storage corruption or a missing snapshot at sequence >0: SHA-256 and projection checks refuse room loading; keep durable JSON/history and restore PostgreSQL from tested backups.
  Do not silently create a new Y.Doc, delete the activation marker or reopen legacy writes. Controlled recovery must
  disconnect sessions and migrate content into a new CRDT document identity, preserving the historical original.
- Back up PostgreSQL including binary state and immutable versions. IndexedDB and Node memory are never substitutes
  for database backup. Turning realtime off preserves authorized REST reads but does not migrate activated rooms back.

## Frontend lifecycle (RH-163)

Only a synced Yjs fragment becomes editable. The legacy autosave controller is explicitly disabled: neither editing,
manual save, online events nor unmount can issue its PATCH in realtime mode. IndexedDB is loaded before transport
connects. Reconnect obtains a fresh scoped credential and merges state vectors instead of replacing the document.
The save badge requires connection, synchronization, zero pending updates and an authoritative commit notification;
disconnect or a zero counter alone cannot claim Saved. Persistence failure remains visible through disconnect until
successful durable synchronization; the dark offline bar and retry action follow the design references. Initial
credential failures can be retried as well. Checkpoints update the read cache and invalidate immutable history.

## Evidence and verification

`collaboration` tests use two real WebSocket/Yjs clients, persistence failure injection, restart/reconnect, revoked
sessions, anonymous/substituted rooms and origin/query rejection. The Spring integration test additionally starts
Node against real Spring HTTP and Testcontainers PostgreSQL, edits concurrently, checks viewer read materialization
and restarts Node. It verifies token expiry, CSRF, member removal/demotion, archives, internal service authentication,
CAS, transactional rollback and blocked legacy replacement. Frontend tests verify token renewal, synchronization,
acknowledgements, offline buffers and cleanup. The opt-in browser E2E launches two isolated Chrome contexts against the actual Webpack app, real Spring sessions,
CSRF and Testcontainers PostgreSQL. It verifies concurrent insertions in an initially empty paragraph, author-local
undo/redo, offline missed-update sync, local buffer recovery after an injected 503, a lost commit response without
revision duplication, manual immutable history, two SIGKILL/restarts and IndexedDB reload. It asserts zero legacy
PATCH autosaves and saves screenshots of both sessions and the failure state. Run `npm run test:browser --prefix collaboration` after installing both lockfiles; Chrome (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`) and Docker are required.
Coverage gates are >=80% in Java, Node and the frontend realtime module.

Verified on 2026-10-05: Maven `verify` passed (733 tests, 5 intentionally skipped, including the opt-in browser test),
frontend 943 tests in 94 suites passed, and Node 14 tests passed. The browser test was also run explicitly and passed
all scenarios above. Builds and frontend lint passed. Coverage: Spring collaboration 99.22% lines / 87.88% branches;
Node 100% / 91.36%; frontend realtime 100% / 88.75%. Production collaboration dependencies passed npm audit with
zero reported vulnerabilities. Build output retains the existing Webpack bundle-size warnings.

Upstream references: [Hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks),
[versioned awaited message handling](https://github.com/ueberdosis/hocuspocus/blob/v3.4.3/packages/server/src/Connection.ts),
[Yjs updates/idempotent sync](https://docs.yjs.dev/api/document-updates),
[Tiptap collaboration and undo history](https://tiptap.dev/docs/editor/extensions/functionality/collaboration).
