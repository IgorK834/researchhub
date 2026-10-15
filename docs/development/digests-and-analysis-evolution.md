# Catch-up digests and analysis evolution (Tasks 36.5–36.7)

The modular monolith uses PostgreSQL, Spring scheduling, the existing workspace authorization,
Task 36.2 notification outbox, Task 15.4 immutable execution records, and Task 32.3/32.5 admission/runtime
limits. No new runtime dependency or paid service was added.

## In-app digest

The notification drawer shows counts grouped by workspace/category since the explicitly acknowledged
cursor, plus completed daily/weekly UTC windows (weeks start Monday). Opening the drawer does not mark
anything seen. POST `/api/notifications/digests/seen` accepts the server's returned `through` timestamp;
updates are monotonic and account-persistent. Reload retains preferences and cursor.

GET `/api/notifications/digests` returns `since`, `through`, `sinceLastSeen`, `digests` and `truncated`.
GET `/api/notifications/digests/preferences` and PUT `.../preferences/{workspace}` configure DAILY
(default), WEEKLY or MUTED and muted notification categories. Account Settings and the drawer expose
these controls and Restore defaults. Account/security notices use the existing account lifecycle channel;
these controls never suppress password reset, verification, session/security or erasure communications.

`NotificationDispatcher.scheduledDigests` runs with the existing hourly cleanup schedule. Outbox events
are the durable job input; failed transactions retry on the next tick. Both window projections are prepared
for local session selection; the selected frequency alone is visible. A unique recipient/membership/window/
frequency key makes retry and concurrent schedulers publish one projection. Each tick handles at most
200 new windows; acknowledged windows cannot starve later jobs. Cursor and scheduler use injected Clock.

Digest retention is 30 days; existing individual notifications/outbox keep their independent 90-day policy.
Cleanup removes up to 1000 expired projections per tick; read-time cutoffs apply immediately. At most 100
workspaces, 100 recent workspace/category aggregates and 20 published windows leave the API. Windows
are bounded to one day/week. Payloads contain counts and server-built workspace deep links, never source
bytes, prompts, generated content or email addresses. Current membership identity and workspace erasure
state are checked before aggregation and every historical read. Revocation deletes projections/settings;
rejoining cannot revive an old membership's events.

In `researchhub.environment=demo`, preferences and cursor live in the authenticated Spring Session
(serializable strings), so two guests sharing one account remain independent, including after reload.
`researchhub.notifications.session-local-preferences=true` enables that same policy explicitly in fixtures.
No demo preference writes to account-global preference/cursor tables.

This delivery is in-app only: it does not send digest email or invoke AccountMail/SMTP, Gemini or an external
provider. Existing account mail remains separate. There is no digest email opt-in control or sending path;
a future optional adapter must use the existing account mail port, require explicit SMTP setup and an
unsubscribe mechanism before enabling delivery. External mail providers may charge fees; no zero-cost
provider promise is made. SMTP is unnecessary for the base VPS demo.

## Source staleness

Analysis detail/list add `staleness: {stale, staleReasons, changedInputs}`. Each changed input has scoped
original/current version identity, number/hash and a deterministic reason: SOURCE_REPLACED,
INPUT_UNAVAILABLE or WORKSPACE_ARCHIVED. Mutable assessment stays outside frozen execution records,
result/provenance hashes and published document values. Dataset detail/list and embedded document blocks
show older inputs; blocks only refresh their status, never their table/chart reference.

V54's transactional source-version trigger examines only dependent `analysis_inputs`. It emits one
ANALYSIS_INPUT_CHANGED audit event and ANALYSIS_STALE product notification per analysis/new source version.
The unique dedup index and existing outbox recipient key prevent duplicate delivery on retry. No model or
sandbox call occurs on replacement or status reads. Queries bind all source joins to the authorized
workspace; absent inputs expose no foreign details. Existing erased-workspace authorization remains in force.

Original reproduction continues to execute the frozen bytes/code/saved runtime, preserving exact source
hashes and rejecting unavailable bytes/runtime through existing failure states. Explicit Latest uses the
existing linked analysis/planning/admission path and its model budget. Nothing automatically replans or
spends Gemini budget on upload. An archived workspace remains readable but cannot execute new work.

## Parameter runs

See [v1 contract](../../contracts/analysis/parameters/v1/README.md). The scientific problem page shows exact
units/defaults, bounds, a change preview, plot bounds and explicit sandbox-only cost mode. It retains the
same idempotency key after network failure and changes it on edits. Success opens the linked child, shows
its durable execution/result/error state and compares output values with the parent's original result.
Formula edits keep their existing separate planning workflow.

New preferences/projections/run receipts are included in the personal-data inventory, account export,
workspace revocation and terminal account erasure. Run receipts cannot be rewritten by ordinary SQL writers.

## Reproducible validation

From `frontend`: `npm run test:coverage -- --runInBand`, `npm run lint`, `npm run build`.
From `backend`: `ANALYSIS_SANDBOX_TESTS=true ./mvnw clean verify` (Docker/pinned sandbox image required).
The existing JaCoCo notification gate enforces 80% lines and branches; `analysis-input-evolution-coverage`
adds the same gate for changed executable analysis components. Jest enforces the same thresholds for
notifications and each new analysis component/API.

Browser validation after the production frontend build:
`ANALYSIS_SANDBOX_TESTS=true ANALYSIS_EVOLUTION_BROWSER_TESTS=true COLLABORATION_WORKFLOW_BROWSER_TESTS=true
./mvnw -Dtest=AnalysisApiIntegrationTest,ParameterRunApiIntegrationTest,CollaborationWorkflowApiIntegrationTest test`.
These tests use synthetic accounts and local isolated PostgreSQL, real sandbox arithmetic/verification,
EN/PL UI assertions, reload and axe checks. Screenshots/results are written under
`backend/target/analysis-evolution-browser`, `backend/target/analysis-staleness-browser` and `backend/target/collaboration-workflow-browser`.
No live Gemini request or external SMTP delivery is necessary for these tests.
