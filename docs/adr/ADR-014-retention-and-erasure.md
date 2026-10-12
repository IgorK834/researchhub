# ADR-014: Retention and erasure across immutable provenance

- Status: Proposed
- Date: 2026-10-12
- Backlog: RH-350; design input for Task 30.7
- Implementation trigger: before accepting non-synthetic hosted data or promising user/workspace erasure; Task 30.7 must first accept the windows and threat model below.

## Current behavior and decision boundary

[ADR-005](ADR-005-immutable-source-versions.md) retains immutable source versions indefinitely. PostgreSQL
triggers prevent source-version mutation/deletion; document versions, execution records, review/audit
history and frozen exports also contain content/provenance. Archiving hides or locks a resource through
authorized product flows; it is **not erasure**. There is no complete erasure API, scheduler, backup scrub
or retention-policy enforcement. This ADR unblocks the **design** of Task 30.7, not its implementation.
No legal compliance, fixed deletion guarantee or existing purge capability is claimed.

Preserve append-only operational history during ordinary use, while allowing a narrow, audited erasure
lifecycle to remove sensitive payloads. Immutable means no silent replacement of historical inputs;
it does not mean personal content must be retained forever. Historical links resolve an explicit erased
stub after erasure, never substituted "latest" bytes. Reproduction reports `INPUT_ERASED` conceptually;
that future result code must be specified/versioned before use, not exposed by today's API.

## Proposed lifecycle

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
   are separate future statuses, to be defined in Task 30.7's public contract.

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

Task 30.7 must introduce additive Flyway migrations; never rewrite old migrations or globally disable
immutability triggers. Design separate provenance headers from erasable payloads, or a narrowly authorized
terminal redaction path that cannot mutate an original into different live content. Dedicated maintenance
authority must be inaccessible to ordinary application users. Reconcile existing foreign keys, immutable
triggers and all new content-bearing tables before selecting the final schema.

Record an erasure ledger outside restorable product backups or replay it from a separately retained
authority. Before restored data can serve traffic, reapply tombstones, purge affected restored content
and revoke old sessions/URLs/epochs. Otherwise PITR resurrects erased data. Test recovery at the oldest
retained backup, partial Blob deletion, jobs finishing after tombstoning, duplicate requests, conflicting
scope, revoked actors and references in rendered DOCX/PDF/LaTeX. Define who verifies backup expiry.

Browser IndexedDB/offline Yjs state and user-downloaded exports are additional copies. The future client
must clear affected local state when notified and reject old-epoch synchronization. A server cannot prove
deletion from an offline device or a recipient's downloaded file; disclose that boundary in the future
public contract. Workspace authorization and provenance remain mandatory throughout the lifecycle.
