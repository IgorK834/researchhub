# Account data, workspace governance and document provenance

RH-338, RH-339 and RH-341 implement the accepted active-store lifecycle in
[ADR-014](../adr/ADR-014-retention-and-erasure.md). Java coordinates authorization,
PostgreSQL jobs and storage; Python continues to own parsing/AI/computation.

## Account contracts

- `GET /api/account/export`: authenticated JSON `schemaVersion=1.0`, generation time,
  identity and explicitly inventoried, attributable records. Passwords/password hashes,
  lifecycle tokens, session credentials, storage keys and binary artifacts are excluded.
  Workspace research payloads require current membership and an untombstoned workspace.
  Source/version metadata and extraction JSON are included; binary sources and reports
  are downloaded through their existing authorized APIs. Limits: 64 MiB total JSON and
  100,000 records per table; exceeding a limit refuses the export instead of truncating it.
- `DELETE /api/account`: authenticated, CSRF-protected JSON `{ "password": "..." }`.
  Confirms the current password; replies `202` with `jobId`, a random `receipt`, `PENDING`,
  policy `ADR-014/live-erasure-v1` and `backupStatus=OUTSIDE_LIVE_STORE_SCOPE`.
  Confirmation bodies and receipt objects have redacted `toString()` implementations.
- `GET /api/account/deletions/{jobId}`: reads only that job using `X-Erasure-Receipt`.
  This read works after session revocation. Missing/wrong receipts return the same 404.
  Receipts are hashed in PostgreSQL and never put into URLs or logs. The response reports
  request time, live-erasure time, attempts, status and a content-free retry code.
- Account exports and confirmations use the existing shared PostgreSQL operation limiter
  (10 per caller per aligned hour). Successful exports and accepted/completed erasures
  append account audit events.

`PENDING` includes retriable cleanup failures; `RUNNING` is the worker's transaction state;
`SUCCEEDED` means reconciled live stores. It makes no assertion about backup-media expiry,
other browsers/offline devices, mail recipients or downloaded files. The UI keeps only an
opaque receipt in navigation state, clears authenticated query caches and attempts to remove
this browser's `researchhub:` IndexedDB copies. It reports blocked/unavailable local cleanup.

## Ownership and erasure

An owner with other members receives standard `CONFLICT` and a clear transfer/leave error.
The request also refuses research contributions in a retained workspace, including historical
versions/block operations after membership removal: an account cannot silently purge a team's
research. The workspace owner must resolve that content's erasure scope. A shared viewer without
research contributions can erase the account; their memberships are revoked immediately and
identity lookups return `Deleted account` while cleanup is pending.

Private owned workspaces, including archived ones, receive terminal tombstones. They reject
reads, signed URL issuance, generation/execution and new publication. Credentials are revoked
and room epochs are advanced. Database publication triggers take workspace/actor locks so a late
worker cannot republish erased content. The durable object manifest covers every source version;
Azure erasure deletes current blobs, versions and snapshots and checks retained/deleted copies.
Soft-delete retention, holds, SDK failures and incomplete reconciliation leave the job pending.

The dispatcher runs every five seconds, claims one PostgreSQL row using `FOR UPDATE SKIP LOCKED`,
and retries storage failures after a minute. Object deletion is idempotent. A crash rolls back
DB publication; a subsequent worker reconciles missing bytes before committing terminal erasure.
Every source/derived extraction, chunk, embedding, plan, execution, solution, export, conversation,
proposal, document/version/CRDT payload and private trace in the erased workspaces is removed.
Tokens, invitations and email-derived limiter keys are removed. The user becomes an unloggable
pseudonymous row with an invalid credential sentinel; original identity fields are overwritten.

Minimal headers retain source/version IDs, type, size, pseudonymous uploader and erasure time.
A content digest is retained only for classified TXT/CSV bytes without the account's identity
markers in names or content. Binary, unavailable, identity-bearing or unclassified inputs have
`content_sha256=NULL`; no digest of a name/email/password hash is kept as an identity substitute.
Product/account audit headers remain append-only. Review headers survive without names or bodies.
These identifiers are pseudonyms, not a claim of irreversible anonymisation.

`PersonalDataInventory` explicitly enumerates every application table. Schema tests fail if a
new table is unclassified, scan all rows for erased identity values, assert that erased workspace
payloads/binary artifacts disappear, and exercise real worker/embedding/sandbox/export data.

## Database authority and restoration

Flyway V46/V47 own all schema changes; Hibernate auto-DDL remains disabled. V47 preserves existing
trigger bodies and adds a terminal path available only to the `researchhub_erasure` NOLOGIN role.
It is never granted to the application role. The definer functions expose controlled erasure;
ordinary sessions cannot use a setting to bypass immutability. Existing initially deferred keys
stay deferred; other content FKs become deferrable with normal immediate checks, allowing a
terminal transaction to remove cyclic canvas/source graphs together.

Migrations need an administrator with role-creation/table/function ownership privileges. In a
hosted deployment use separate migration and runtime roles. Grant the runtime role table privileges
required by the application and `EXECUTE ON FUNCTION finish_account_erasure(uuid)`. Do **not** grant
`researchhub_erasure` membership or `EXECUTE ON FUNCTION replay_account_erasure(...)` to that role.
The synthetic local/Testcontainers administrator intentionally has broader privileges.

Before accepting a request, the application writes an immutable, content-free receipt to
`erasure-ledger/{requestId}.json` in existing Blob storage. This namespace is the restore authority
outside PostgreSQL backups; it contains only request/actor/workspace UUIDs, policy and time.
Source erasure never deletes it. Storage/RBAC/lifecycle policies must retain this authority across
all restorable product snapshots. Never roll the authority namespace back with product data.
If the authority cannot be recorded, the database request rolls back and deletion is not accepted.

Restoration procedure, while traffic and workers remain offline:

1. Download only authenticated `erasure-ledger/` objects into a protected directory. Keep the authority
   separate from restored product snapshots; arbitrary uploaded JSON is not an erasure authority.
2. Run `python3 scripts/erasure/replay-ledger.py /protected/ledger` to validate every receipt.
3. Configure `psql` through `PGSERVICE`/`PG*` for the offline restored DB with the maintenance administrator;
   rerun with `--apply`. The definer reapplies account/workspace tombstones, removes restored memberships
   and credentials, and rebuilds the durable source manifest. Replaying is idempotent.
4. Run the erasure dispatcher to reconciliation. Verify **all** pending jobs are complete before allowing
   restored traffic, then separately verify backup expiry under the deployment's retention policy.

No new backup service, queue, cloud resource or fixed deletion/retention guarantee is introduced.
The windows in ADR-014 remain engineering targets requiring operational verification.

## Workspace governance

Owner-only `GET /api/workspaces/{id}/audit/export?format=csv|json` streams product, review and model-call
headers in 200-event keyset pages. Maximum 100,000 events; larger exports are refused. Only event ID,
kind, actor ID, event, resource type/ID and time are read. No generic metadata/payload, prompt, response,
query, title or source text can enter the exported file. Equal timestamps are ordered by ID and kind.
Each request is audited and limited to 10 per caller/workspace per hour; authority is rechecked per page.
Revocation/disconnection aborts the stream. Response headers force private/no-store attachment downloads.

Owner-only `GET /api/workspaces/{id}/ai/usage?days=1..90` aggregates existing economic telemetry by
feature over `[from,to)`: requests, failures, known-usage count, nullable input/output token totals.
Null means unknown. It reads no diagnostic payloads and adds actual current quota consumption from the
same configured memory/PostgreSQL adapter and policy used for admission. Both endpoints return 403 to
non-owning members and 404 to foreign/missing workspaces. Settings show summaries and request quotas.

## Document provenance

Citation chips, selected paragraphs (also `Alt+P`) and every analysis render mode offer `Show provenance`
through one shared, focus-trapped side panel. Selection controls render outside document content and
never change the saved tree. Escape closes the panel and returns focus to its trigger.

The panel uses existing source-version, block-provenance, execution-record and solution APIs. It shows
immutable versions/locators/hashes and exact reader links; saved code/input hashes, runtime/image,
duration, outputs and rerun origin; AI model/version, stored template ID/hash and approving actor/time.
The block-provenance read joins existing suggestion/proposal records for template metadata; it creates
no new provenance. Missing legacy fields are explicit, without substituting current templates/sources.
Solution contracts that have no duration show `Not recorded`, without fabricating a runtime measurement.
Loading, absent/empty and failed reads are explicit. Browser E2E applies WCAG axe checks to all three
panels, confirmation/receipt and workspace governance, with real authorized API reads and downloads.

## Verification

`cd backend && ./mvnw verify`

`cd frontend && npm run build && npm run lint && npm run test:coverage -- --runInBand`

After building the frontend, run the real browser flow on its isolated fixture database:

`cd backend && GOVERNANCE_BROWSER_TESTS=true ./mvnw -Dtest='SourceExtractionEndToEndTest#productionBrowserCoversProvenanceGovernanceAndDurableAccountErasureWithAxe' test`

JaCoCo and Jest enforce at least 80% module coverage. `package-lock.json` pins the added axe test dependency.
