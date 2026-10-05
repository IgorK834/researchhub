# Computation provenance v1 (RH-154)

`GET /api/workspaces/{workspaceId}/analyses/{analysisId}/executions/{executionId}/provenance`
returns a self-contained, log-free citation object. Every request reauthorizes workspace and exact source-version
access. Responses are `no-store`; image/code URLs require the same authenticated access. No runtime, source blob,
model request or Python execution is needed to inspect this object.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1.0` |
| `workspaceId`, `analysisId`, `executionId`, `status` | Server-bound identities and persisted execution state |
| `inputSources` | Exact source/version IDs, version number, original filename, format, byte size, SHA-256 and selected sheets/physical columns, from the frozen execution record |
| `prompt`, `planSummary`, `warnings` | Original request and accepted plan context |
| `code` | `{language: "PYTHON", sha256, url}`; `url` opens the authenticated read-only code endpoint |
| `result` | Saved result schema and TABLE rows/columns, CHART artifact references, or TEXT output; null while unsuccessful/unpublished |
| `charts` | Validated title/axes/series and server-bound analysis/execution/code/image references; legacy missing metadata stays explicitly absent |
| `outputReferences` | One `{name, kind, provenanceUrl, detailsUrl, artifactUrl}` per saved output; `detailsUrl` selects this execution and anchors its output, `artifactUrl` is null for tables/text |
| `executionTimestamp`, `startedAt`, `finishedAt` | UTC execution timestamps; `executionTimestamp` is the completion time and remains null until completion |
| `runtimeVersion`, `imageId` | Recorded scientific runtime and immutable image digest; null when unavailable/unrecorded |
| `lineage` | Origin execution, original/latest input mode, exact version comparisons and requested original runtime; null for earlier ordinary executions |
| `executionHash` | SHA-256 of the serialized persisted execution contract with `diagnostics` replaced by null |
| `links` | Authenticated `provenance`, `record`, `code` API paths and the execution-specific frontend `details` path |

The execution hash includes the unique execution ID, timestamps, plan/code/input provenance and saved results. It
changes for a new execution even when code and numerical results are identical. It is stable for a completed
execution after restart and after source replacement. A code or input content hash correctly stays unchanged when
the same bytes are reused. The hash algorithm is tied to this contract version and the server's execution JSON
serialization; it is not a client-side signature or a claim that arbitrary generated code is deterministic.

`GET .../executions/{executionId}/code` returns `{analysisId, executionId, language, sha256, source}` from the frozen
plan. It has no update or execute operation. The source is untrusted text: consumers render it as inert, read-only
content. Runtime diagnostics and exception traces are deliberately absent from the citation response.

The details URL is `/app/workspaces/{workspaceId}/analyses/{analysisId}?execution={executionId}`. Each saved output
has a stable `#output-{index}` anchor using its original persisted result order. Document/AI consumers can retain
the API URL, execution ID and output reference rather than linking to whichever attempt is newest. A later rerun
never redirects or mutates that citation. Actual document insertion remains a future workflow; its visible action
is disabled, and this task does not introduce document writes or an image-upload feature.

Related contracts: [execution record](../../record/v1/README.md), [structured charts](../../execution/v2/README.md),
[reproduction workflow](../../rerun/v1/README.md).
