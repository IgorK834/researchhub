# Explicit analysis reproduction v1 (RH-153)

`POST /api/workspaces/{workspaceId}/analyses/{analysisId}/executions/{executionId}/rerun`
accepts exactly `{ "inputMode": "ORIGINAL" }` or `{ "inputMode": "LATEST" }`. Unknown fields, code, Docker options
and caller-supplied version/image IDs are rejected. Session authentication, CSRF and server-side content-editor
authorization apply; archived workspaces are read-only. Only a completed successful/failed origin can be rerun.

- **ORIGINAL** queues a new execution of the origin analysis's immutable accepted plan and exact versions. It
  retains the code and plan hashes. When the completed origin recorded its runtime, the server requests that
  local image digest and verifies its version label. Missing/mismatched images fail closed without pulling or
  silently falling back to a newer image. If the original runtime was not recorded, the current pinned runtime
  is used and the UI states that exact environment reproduction is unavailable. Current sandbox isolation and
  resource limits always apply.
- **LATEST** resolves each source's current immutable active version at request time. Versions must be ready and
  have the same dataset format. Every previously used sheet and column label/physical position is checked against
  the bounded inspection. Missing/renamed/reordered selections require a new reviewed request rather than guessing.
  The server creates a new derived analysis with the original user prompt and selections, records its immutable
  origin in `analysis_origins` (Flyway V23), and runs the normal audited planning flow before queueing execution.
  The new code binds to the selected new version filenames. Old successful executions and outputs remain untouched.

Response `202`, `no-store`, with `Location` naming the new execution or retained derived request:

```json
{
  "analysisId": "target analysis UUID",
  "execution": "the ordinary queued Execution object, or null",
  "lineage": {
    "originAnalysisId": "origin analysis UUID",
    "originExecutionId": "origin execution UUID",
    "inputMode": "ORIGINAL or LATEST",
    "versions": [{
      "sourceId": "source UUID",
      "originalVersionId": "original version UUID",
      "originalVersionNumber": 1,
      "selectedVersionId": "selected version UUID",
      "selectedVersionNumber": 2
    }],
    "requestedRuntime": null
  },
  "failureCode": null
}
```

`requestedRuntime` is `{imageId, runtimeVersion}` only when reusing a recorded original runtime. The immutable
execution snapshot includes `lineage`; legacy snapshots deserialize with null lineage. The UI compares version
IDs to report changed/unchanged inputs, including the case where latest versions have not changed. Code and input
content hashes may correctly stay the same, but every new execution has a new ID/timestamps and execution hash.

If derived planning/enqueueing fails, the response retains its new analysis ID, lineage and a safe failure code,
with null execution. The UI opens that retained state. No automatic retry or hidden code execution occurs. Failures
before creating intent (incompatible/unready selections or missing authorization) use ordinary safe ProblemDetails.

`GET /api/workspaces/{workspaceId}/analyses/{analysisId}/origin` returns `{lineage: <Lineage|null>}` and reauthorizes
the analysis. This keeps a derived request's origin inspectable even if it never obtained an accepted plan or run.

[Citation endpoint and execution hash](../../provenance/v1/README.md).
