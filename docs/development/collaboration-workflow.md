# Notifications, mentions and review tasks (Tasks 36.2–36.4)

The feature uses the existing modular monolith, PostgreSQL 17, Spring session/CSRF and TanStack Query. It requires no broker, extra WebSocket, paid integration or new library. Yjs anchors and frozen scientific provenance are unchanged.

## Delivery and privacy

`ProductAudit` remains append-only history. Migration V53 adds a transactional outbox trigger and separate notification projection. Comments retain their contribution audit. Recipients are captured in the original transaction, excluding the actor except for completed/failed analyses. The outbox stores only typed event/target/recipient ids, membership identity and timestamps, never titles, comment bodies, emails, prompts, code or scientific output.

The dispatcher claims at most 50 rows per tick with `FOR UPDATE SKIP LOCKED`. Insert and acknowledgement commit together. Rollback leaves work durable and schedules exponential retries capped at one hour. `UNIQUE(user_id,event_id)` protects against repeat delivery and simultaneous dispatchers. A process crash before acknowledgement is retryable without a lease or broker. Delivery locks and checks current membership. Muted types and mentions edited away before delivery are acknowledged without a notification. Projection failures do not undo the originating committed audit event.

Only comment creation/replies/new mention recipients, analysis completion/failure, review creation/assignment/due changes and the recipient's role changes are actionable. Autosaves, presence, readiness, operational metrics and Canvas stage telemetry never enter the feed. Text-only review edits and status updates are audited without notifying their actor. A mention takes precedence over a generic comment notification for the same event/recipient.

Workspace/document/task labels are resolved only at authorized read time, never copied into the audit/outbox. The feed joins the same membership row, active user, workspace erasure state and authorized target before reveal. Removal immediately deletes that user's workspace projections and preferences. Rejoining creates a new membership identity and cannot revive an old feed. Target endpoints independently authorize access. Missing/foreign targets reveal no task title/description or notification. Historical audit events are not backfilled because their original audience cannot be reconstructed safely.

Notifications and outbox entries expire after 90 days. Delivery retains at most 1,000 notifications per user. Cleanup removes at most 1,000 expired rows per table per hour; expired entries are invisible immediately. Counts saturate at 1,000 and expose `countCapped`. Preferences are workspace/user/type scoped and affect future delivery. Terminal account erasure removes projections and owned review content using the existing maintenance authority.

## API

Every endpoint requires the signed-in user; mutations require CSRF. Request bodies cannot supply caller ids.

- `GET /api/notifications?cursor=&limit=20&unread=false&type=MENTION`: maximum 50 items and keyset pagination. Cursor is tied to the user and filter. Returns `items`, `nextCursor`, `unreadCount`, `countCapped`; the server generates protected deep links.
- `POST /api/notifications/{id}/read`: 204, idempotent `readAt`; foreign or revoked scope gets 404.
- `POST /api/notifications/read-all`: `{before: UTC instant, limit: 1..100}` changes only unread visible rows at/before the boundary. New arrivals remain unread. Returns `{updated}`; repeat for another bounded batch.
- `GET/PUT /api/notifications/preferences/{workspaceId}` lists overrides or sets `{type, muted}` for the current user/workspace.
- `GET /api/workspaces/{id}/people?q=` returns at most 10 active current members. Display-name queries have at most 80 characters. Responses contain only `userId` and `displayLabel`, never emails or a global directory.

## Typed comments

Comments/replies accept `mentions: [{userId, displayLabel, start, end}]`, at most 20 ranges. UTF-16 ranges refer to the trimmed comment body, not mutable document offsets. Non-overlapping ranges must exactly cover `@displayLabel`. The server verifies current membership and label under the membership-mutation lock. Invalid, foreign or revoked recipients get 400. Literal `@email` or `@ai` text never grants an audience or starts AI.

Responses include root `revision` and mentions with current `available` state. Author-only `PUT .../comments/{id}/body` requires `{revision, body, mentions}`, preserves the anchor/target and returns 409 for stale revisions. Removing or retaining a recipient produces no new mention event; adding one in a new revision does. Creation/reply UUID retries must match body, anchor and typed identities. Existing plain-text clients remain compatible. Explicit `@ai` evidence keeps its separate authorization and quota.

## Review tasks

`POST/GET /api/workspaces/{id}/review-tasks` and `GET/PATCH .../{taskId}` enforce workspace capabilities. Readers include viewers; creation, assignment and completion require `EDIT_CONTENT` in an active workspace. Assignees must be active current members. Tasks never change sources or scientific results.

Create sends a client UUID, plain title (1–200 characters), description (0–4,000), target, optional assignee and UTC `dueAt`. Targets: DOCUMENT/ANALYSIS ids; COMMENT id plus `documentId`; EVIDENCE_FINDING report id plus `findingIndex` (0–4 in the immutable report). Evidence links reopen the retained finding without executing AI.

PATCH replaces editable state `{revision,title,description,assignee,status,dueAt}`; null clears assignment/due date. Identity, target and creator are immutable through the API. Competing updates get 409. Unchanged updates are no-ops. Transitions: OPEN → IN_PROGRESS/DONE/CANCELLED; IN_PROGRESS → OPEN/DONE/CANCELLED; DONE/CANCELLED → OPEN; unchanged status is allowed.

Removing an assignee sets `assignee=null`, `unassignedReason=MEMBER_REMOVED`, increments revision and appends a product audit event. Tasks stay visible to current members. Each workspace retains at most 500 tasks, including terminal tasks. Creation replay does not consume capacity. Keyset lists have at most 50 items and ALL/MINE/OPEN/OVERDUE filters; OPEN includes IN_PROGRESS, overdue excludes terminal tasks.

## UI and verification

The global bell polls every 30 seconds while the page is active. Panel/task lists retain at most five 20-item pages, with a Newest action returning from history to the first page; polling pauses in the background. The panel provides unread/type filters, bounded mark-all, preferences and loading/empty/error states. Access errors hide cached entries. Existing dialogs restore keyboard focus and dismiss with Escape. Member selection uses labelled combobox/listbox, ArrowUp/Down/Enter/Escape, no matches and error states. React escapes names/task text. English and Polish are supported.

In `frontend`, run `npm run typecheck`, `npm run lint`, `npm run test:coverage -- --runInBand`, `npm run build`. In `backend`, run `ANALYSIS_SANDBOX_TESTS=true COLLABORATION_WORKFLOW_BROWSER_TESTS=true ./mvnw clean verify` (Docker and Chrome or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` required). CI enables the browser test. Existing Jest/JaCoCo independently enforce ≥80% line and branch coverage for notifications, mentions and review tasks, plus the existing comments and combined workflow gates.

HTTP tests cover idempotency, actual concurrent requests, user/cursor isolation, bounded reads/counts/retention, muted and failed delivery/retry, typed recipient/edit validation, revocation/rejoin, UTC dates, target isolation and capacity. The browser test runs the production bundle with real Spring/PostgreSQL to create a typed mention by keyboard, follow its notification, assign a comment review, find it in Mine, complete/reload it, switch locale, check axe and revoke access. Artifacts: ignored `backend/target/collaboration-workflow-browser/`.
