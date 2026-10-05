# Durable execution record v1 (RH-150)

`GET /api/workspaces/{workspaceId}/analyses/{analysisId}/executions/{executionId}/record` returns a no-store,
workspace-authorized record. Owner/editor/viewer reads use the same immutable source-version scope as the analysis;
foreign executions, artifacts and workspaces are hidden. Creation/re-run still requires owner/editor permission,
an active workspace, a session and CSRF. A record read never contacts the model or runner or reopens source blobs.

The public shape is `ExecutionContracts.ExecutionRecord` (Java), mirrored by `analysisApi.ts` (TypeScript):

| Field | Durable content |
| --- | --- |
| `schemaVersion` | `"1.0"` for this inspection envelope |
| `snapshot.userPrompt` | Original request |
| `snapshot.plan` | Full accepted structured plan, generated Python, operations, assumptions and warnings |
| `snapshot.inputs[]` | Source ID, immutable version ID/number, original filename, format, bytes and SHA-256 |
| `snapshot.inputs[].sheets[]` | Actual planned sheets; selected physical column indices and inspected labels |
| `execution` | Attempt ID/number, status, requester, creation/start/end, result/failure and bounded diagnostics |
| `execution.provenance` | Accepted plan ID, plan/code/input hashes, resolved image ID and runtime version |
| `charts[]` | Typed title/axes/series, server-bound source analysis/execution/code references and immutable image metadata |

`charts[].image` holds artifact ID, filename, media type, byte size and SHA-256. Bytes are persisted in PostgreSQL
`analysis_execution_artifacts.content` and served only by that workspace/analysis/execution/artifact endpoint; there
is no public bucket or client-supplied storage key. TABLE rows and column metadata remain in the execution result
JSON. See [output v2](../../execution/v2/README.md) for series semantics and limits.

Flyway V22 freezes one `analysis_execution_records.snapshot` per attempt in the same enqueue transaction. Its input
metadata must match the exact immutable versions and its prompt/plan must match accepted intent. Update/delete
triggers preserve the snapshot, just as V20/V21 preserve source selections, planning evidence, completed attempts
and image bytes. Explicit retries append a new record and execution. No successful history is overwritten.

V22 backfills pre-existing attempts from immutable accepted intent, source versions and the saved planning inspection
without running code or changing historical execution payloads. Missing historical column labels remain null; the
UI displays their physical indices. Historical diagnostic summaries are sanitized on read, retaining the original
stored evidence. New stdout/stderr summaries remove terminal/control/direction sequences, redact credential-shaped
values and retain at most 8,192 characters per stream with truncation flags. Raw runner retention remains 64 KiB.

The record is inspectable after a full application stop/start with the same database, even when the worker/runner
is disabled and no source blob is opened. Keeping the exact input bytes and the recorded image available separately
is necessary to execute the computation again. The explicit ORIGINAL rerun requests the saved image digest/version
when recorded; the legacy execute endpoint uses the current pinned runtime. Both retain data and accepted code.
The record identifies the original environment without promising bit-identical images or log/timing output across
runs. RH-153 adds optional `snapshot.lineage` with origin IDs, original/latest input mode, version comparisons and
requested original runtime. Legacy snapshots have null lineage. See the [rerun contract](../../rerun/v1/README.md)
and the log-free [citation contract](../../provenance/v1/README.md).
