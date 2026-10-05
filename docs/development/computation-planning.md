# Computation requests and plans (RH-140, RH-141)

The `analysis` module owns engine-independent computation intent. Runtime execution and result persistence extend these
contracts in [analysis-execution.md](analysis-execution.md) (RH-143–RH-145). Java owns workspace authorization, the lifecycle,
structural/reference validation and persistence; Python owns the model adapter. Source comparison in `ai` remains a
separate, read-only literature workflow. `Analysis_studio.pdf` pages 2–4 and `Results,provenance&insert.pdf` page 1 inform
the input selection and provenance concepts; this change supplies their backend contracts, not new analysis screens.

## Product API

All routes are session authenticated and return `Cache-Control: no-store`. Mutations require CSRF and workspace
`EDIT_CONTENT` (owner/editor, active workspace). Readers, including viewers, can inspect existing requests and audits.
Non-members and foreign-workspace resources return `404`; viewers receive `403` for mutations. Inputs are independently
checked by the source module and composite foreign keys enforce the workspace/source/version tuple in PostgreSQL.

| Method and path under `/api/workspaces/{workspaceId}/analyses` | Contract |
| --- | --- |
| `POST /` | Create `DRAFT`; returns `201` and `Location` |
| `GET /?offset=0` | At most 50 requests, newest first; offset 0–100000 |
| `GET /{analysisId}` | Current request, status, accepted plan and failure code |
| `POST /{analysisId}/plan` | Plan an existing draft; no client-supplied plan/code is accepted |
| `GET /{analysisId}/plans` | Append-only audit of up to three model attempts |

Create body (camelCase, matching existing APIs):

```json
{
  "userPrompt": "Calculate impedance versus frequency",
  "inputs": [{
    "sourceId": "00000000-0000-4000-8000-000000000001",
    "sourceVersionId": "00000000-0000-4000-8000-000000000002",
    "sheetName": "CSV",
    "columns": [1, 2, 3]
  }]
}
```

The prompt is nonblank and at most 4000 characters; 1–5 distinct immutable CSV/XLSX versions must have an available
inspection. `sheetName: null` permits any inspected sheet in that input; `columns: null` permits any inspected column
in the selected sheet. Explicit columns require a sheet, must be unique, and use 1-based physical indices. Empty
column selections are invalid. Inspection is bounded by RH-131; omitted sheets/columns cannot be selected or invented,
and unknown types/counts remain unknown. Header labels and sample values are untrusted text, not identities or units.

## Lifecycle and idempotency

`DRAFT → PLANNING → READY_TO_EXECUTE → QUEUED → RUNNING → SUCCEEDED`; `PLANNING`, `QUEUED` and `RUNNING` can also become `FAILED`.
Execution retries append explicit attempts and allow `SUCCEEDED/FAILED → QUEUED` only with an accepted plan.
The domain enum and database constrain these transitions. The worker accepts the historical `computation-plan:1`
policy and current `computation-plan:2`; v2 describes the controlled runtime output protocol. Original prompt, inputs, authorship and an accepted plan
are immutable. Changing a request means creating a new analysis; replacing a source never changes the chosen version.

Planning atomically claims a draft before its first remote call. Concurrent calls cannot generate twice. Calling plan
again on `READY_TO_EXECUTE` returns the saved result without a provider call. A failed request does not receive a new
retry budget; create a new request. Planning is synchronous and bounded by the existing worker HTTP timeout per call.
Durable execution dispatch, interrupted-process recovery and the separate sandbox are supplied by RH-143–RH-145;
planning remains synchronous and its audit history is retained independently of execution retries.

## Structured plan and model boundary

Machine-readable v1 schemas and shared fixtures live in
[`contracts/analysis/computation-plan/v1`](../../contracts/analysis/computation-plan/v1/README.md). Every plan contains
summary, input versions/sheets/required columns, named transformations and statistical operations with explicit input
references, requested TABLE/CHART/TEXT outputs, assumptions, warnings and `{language: "PYTHON", source: "…"}` code.
Outputs have symbolic names; the trusted isolated runner owns filesystem paths. All fields, lists, requests and responses are
bounded. Extra fields, missing fields, scalar coercion and trailing JSON are rejected at the model-output boundary.

The existing authenticated internal worker channel exposes `POST /internal/analysis/plan` (512 KiB request cap).
Foundry receives the strict plan JSON schema, the versioned/hashed policy and only the selected inspection snapshots;
it receives no source-download URL, storage key, application credential or database capability. Provider connection
configuration and the pinned Python runtime/`uv.lock` are reused unchanged. The deterministic provider generates a narrow impedance CSV/XLSX program for recognized frequency/voltage/current
selections, with explicit unit assumptions. Other prompts retain an inert offline fixture. The worker never executes
code or fabricates numeric results from inspection rows.

One worker call is one model attempt. Spring owns a total maximum of three attempts; `AI_OUTPUT_INVALID` and
`AI_UNAVAILABLE` may be retried with a fixed, bounded repair hint. Refusals and other provider failures stop immediately.
Each bounded candidate is persisted even if its JSON or declared inputs are invalid. Transport failures store only
safe allowlisted codes; provider exception text and credentials are never recorded. A successful attempt additionally
stores the validated plan, model/version, usage, provider request id, policy/hash, input preview/content hashes,
request id, actor and timestamp. `V20` makes audit rows append-only and binds the accepted plan to its analysis.

Both schema and reference validation reject unprovided declared files, sheets, columns, operation inputs and output
provenance. Java repeats inspection and authorization before `READY_TO_EXECUTE`, preventing revocation, archival or
changed metadata during a remote call from approving a plan. **Code remains untrusted after these checks**: a plan can
misrepresent its code. Neither Java nor the AI worker evaluates, compiles, imports or runs generated source.
The executor enforces the independent sandbox boundary described in [sandbox/README.md](../../sandbox/README.md) and
[analysis-execution.md](analysis-execution.md).

## Verification

* `AnalysisPlanningTest`: bounded repair/exhaustion, invalid references/JSON/identity, authorization, revocation,
  idempotency and every lifecycle edge.
* `AnalysisApiIntegrationTest`: real sessions, CSRF, PostgreSQL/Flyway, input isolation, append-only audit, lifecycle,
  safe failures and revoked members.
* `SourceExtractionEndToEndTest`: real upload, Python ingestion, immutable preview, Python planner HTTP, persisted plan
  and source replacement without moving historical inputs or repeating generation.
* `test_computation_planning.py`: shared schema/fixture drift, strict Foundry request, field/reference validation,
  inert hostile code, internal authentication, safe errors and one attempt per call.

In `backend`, run `./mvnw verify`; in `ai-worker`, run `sh scripts/check.sh` with the pinned `uv` tooling available.
The existing Java analysis gate and the new Python
analysis gate both require at least 80% coverage. The scientific dependencies remain confined to the pinned sandbox image; no frontend or additional Java core
runtime dependency is required for execution.
