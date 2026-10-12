# ADR-014: Retention and erasure across immutable provenance

- Status: Accepted for RH-338 active-store erasure; retention windows remain proposed engineering targets
- Date: 2026-10-12
- Backlog: RH-338 / Task 26.6; RH-350 / Task 30.7 operational retention follow-up
- Decision accepted: 2026-10-12, user approval of immediate tombstoning, durable live-store erasure, pseudonymous history, shared-workspace refusal and explicit backup/download boundaries.

## Decision and implemented boundary

RH-338 implements caller-initiated export and password-confirmed erasure as a PostgreSQL durable job.
[The public contracts, authority and restore procedure](../development/account-data-and-governance.md)
are implemented in the same change. No fixed backup-expiry deadline or legal compliance claim is made.
Archiving remains a visibility/write lifecycle and is not erasure.

Private owned workspaces are terminally tombstoned. An owner with other members is refused; historical
research contributions in retained workspaces also require the workspace owner's scope decision.
The account cannot destroy collaborators' research merely because it uploaded or edited it. A shared
reader without such contributions can erase their identity and leave their memberships.

Direct names/emails/password hashes are removed from the user and all inventoried identity-bearing
payloads in the accepted scope. Stable UUIDs become pseudonymous actors; there is no original email/name
lookup mapping. Content-bearing history is removed through the dedicated NOLOGIN definer authority,
while content-free product/account audit and review headers remain queryable. Source receipts preserve
IDs, version number, type, size and erasure time. SHA-256 is retained only for classified TXT/CSV bytes
without identity markers; binary, identity-bearing, unavailable or unclassified inputs have a null hash.
This avoids retaining a low-entropy identity digest as a substitute for erased content.

Every source version is reconciled in Blob storage, including snapshots/versioned/deleted copies.
Retained copies and failures leave the job pending; only reconciled live stores receive `SUCCEEDED`.
An immutable erasure ledger in a separate namespace of existing Blob storage survives PostgreSQL PITR.
A verified offline replay must reapply tombstones and reconcile content before restored traffic opens.
The authority namespace must never be rolled back together with product data.

Preserve append-only operational history during ordinary use, while allowing a narrow, audited erasure
lifecycle to remove sensitive payloads. Immutable means no silent replacement of historical inputs;
it does not mean personal content must be retained forever. Historical links resolve an explicit erased
stub after erasure, never substituted "latest" bytes. Reproduction reports `INPUT_ERASED` conceptually;
that result code remains out of scope and must be specified/versioned before a public API uses it. Deleted workspace reads return the ordinary 404.

## Accepted lifecycle

1. Authorize the actor and workspace server-side; record request ID, scope, policy version and deadlines.
   Account erasure and workspace erasure are different operations: an account cannot erase collaborators'
   shared research merely because it uploaded it. Determine ownership and affected personal content.
2. **Tombstone** immediately: stop public retrieval, signed URL issuance, generation, exports and execution
   for the affected scope; revoke sessions/realtime credentials and invalidate room epochs. Tombstoning
   blocks access while deletion is pending but leaves bytes in storage. Existing signed URLs need expiry
   and, where required, object deletion/key revocation; application authorization alone cannot revoke them.
3. Discover a dependency graph: every source version/blob, extraction/chunk/embedding, dataset profile,
   analysis input/output, frozen solution, document body/version, conversation/prompt, report export,
   cached projection, job retry, audit payload and log containing the selected content. Versioned IDs
   and provenance edges drive this inventory; shared content requires an explicit scope decision.
4. **Pseudonymise** actor references when structural history must remain: replace direct identity with a
   scoped surrogate, remove names/emails and sever the lookup mapping where the approved policy permits.
   A pseudonym is still potentially identifiable; it is not proof of anonymisation. Redact free text and
   exported content too, not only user columns. Do not retain identifying content or low-entropy hashes
   under the pretext of immutable provenance. Keep only justified non-content erasure receipts.
5. **Erase blobs and derived payloads** idempotently, including noncurrent source versions, storage
   snapshots/soft-deleted copies, outputs, export artifacts, caches and search vectors. Keep minimal
   tombstone/provenance headers where justified, with an explicit unavailable/erased marker. Do not
   claim success after deleting only the active source blob or marking its database row archived.
6. Reconcile all stores before marking live-store erasure complete. A crash/retry cannot recreate content;
   schedulers, in-flight workers and publication recheck tombstones. Failures stay pending and observable.
   Record backup expiry separately; "request accepted", "live stores erased" and "backup window expired"
   are separate states: the live-store contract is defined by RH-338; backup expiry remains an operational verification outside that receipt.

## Retention windows to accept before implementation

These are **proposed engineering targets**, not configured product behavior or legal obligations.
No configurable or enforceable retention window is introduced by this documentation change.

| Data class | Proposed window / trigger | Erasure treatment |
| --- | --- | --- |
| Active source versions, documents and provenance | Keep while the workspace is active under its agreed policy | Explicit erasure overrides ordinary reproducibility; references show an erased stub |
| User-archived workspace | 30 days for owner recovery, then policy-controlled purge | An explicit erasure request skips the recovery period |
| Erasure request / derived live copies | Access blocked immediately; live-store target <=7 days | Retry/reconcile; expose pending failure, never falsely acknowledge completion |
| Temporary runner/worker files | One request/attempt; cleanup on success/failure/timeout and crash recovery | No workspace-shared writable cache; bounded quarantine only while diagnosing a cleanup failure |
| Export download artifacts | 7 days after creation | Database provenance header can outlive artifact; copies may also contain source content |
| Content-free operational logs | 30 days | No prompt/source/secret text; identifiers minimized. Content leaks require targeted purge |
| Minimal security/erasure receipts | Proposed 90 days, review justification before accepting | No original document content, identity lookup mapping or reusable signed URL |
| Encrypted backup/PITR copies | Proposed maximum 30 days in production; dev currently 7 days | Restricted restore access, natural expiry recorded; do not claim immediate physical erasure of retained backup media |

Legal holds or collaborator-owned material require a documented authority/scope decision and an explicit
blocked/deferred status before a policy can be promised. The disposable dev IaC disables Blob soft delete
and service versioning and uses synthetic data; that is not a production erasure implementation.

## Append-only enforcement and restoration

RH-338 introduces additive Flyway V46/V47; old migrations are unchanged and immutability triggers are
never globally disabled. Design separate provenance headers from erasable payloads, or a narrowly authorized
terminal redaction path that cannot mutate an original into different live content. Dedicated maintenance
authority must be inaccessible to ordinary application users. Reconcile existing foreign keys, immutable
triggers and all new content-bearing tables before selecting the final schema.

Record an erasure ledger outside restorable product backups or replay it from a separately retained
authority. Before restored data can serve traffic, replay authenticated ledger receipts with the implemented
`replay_account_erasure` authority, reconcile restored content and revoke old sessions/URLs/epochs. Otherwise PITR resurrects erased data. Test recovery at the oldest
retained backup, partial Blob deletion, jobs finishing after tombstoning, duplicate requests, conflicting
scope, revoked actors and references in rendered DOCX/PDF/LaTeX. Define who verifies backup expiry.

Browser IndexedDB/offline Yjs state and user-downloaded exports are additional copies. The client clears this browser's affected query/offline state and old-epoch synchronization is rejected. A server cannot prove
deletion from an offline device or a recipient's downloaded file; disclose that boundary in the future
public contract. Workspace authorization and provenance remain mandatory throughout the lifecycle.
