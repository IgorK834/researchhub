# Approved scientific parameter runs v1 (Task 36.7)

`GET /api/workspaces/{workspace}/analyses/{analysis}/parameters` returns versioned definitions.
`POST /api/workspaces/{workspace}/analyses/{analysis}/runs` accepts `run.schema.json` and returns
`parentAnalysisId`, `analysisId`, `executionId`, `mode: APPROVED_PLAN`, `llmTokens: 0` (202).
The run contract version is the v1 route/definition version; it does not replace the v2 PROBLEM snapshot.

Only the existing scientific PROBLEM AST is parameterized. Every parameter is required, is a canonical
DECIMAL string, keeps its exact original unit, and has inclusive bounds −10¹²…10¹². Unknown parameters,
JSON numeric/boolean coercions, missing/null values, exponent notation, trailing decimal zeroes and negative
zero are rejected. The server revalidates AST dimensions/operations and solve degree 1–4 before quota
admission or container creation. Plot endpoints use the same bounds; points remain 2–201 and start < end.
Only an existing approved plot's bounds/point count may change; output, parameter, formula and units stay fixed.

ORIGINAL and LATEST are explicit choices. PROBLEM has no source files, so both preserve its frozen context,
AST and units. DATASET analyses with generated Python do not expose arbitrary literal/code substitution:
the existing Original/Latest reproduction route remains available, with explicit planning/model budget
for Latest. A new formula, unit or plan is a separate planning step.

Idempotency is scoped to workspace/parent/caller/key, checked under a transaction lock, and rejects changed
payloads (409). Creation, snapshot, approved plan binding, queue admission and the idempotency receipt share
one database transaction. Retries return the same execution even after completion; no additional admission
or model usage occurs. A run owns a new input/plan hash and parent analysis ID. The original analysis,
execution, result, audit, runtime/code hashes and published document blocks are never rewritten.

The existing pinned sandbox and verification phases produce/verify the numeric result and code hashes.
The plan's `problemHash` is rebound deterministically to the new snapshot; formula ASTs are unchanged.
There is no planner call or fabricated LLM usage event. Runtime failures use existing durable execution
failure states, including disabled/unavailable runtime and access revoked before dispatch.
