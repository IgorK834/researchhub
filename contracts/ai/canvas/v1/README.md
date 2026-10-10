# Canvas AI v1

`canvas.schema.json` is JSON Schema 2020-12; individual schemas select its named definitions.
`capture`/`context` are implemented by CAI-03. First turn, continuation, turn state, proposal,
execution, acceptance and receipt are normative contracts for CAI-04–09/11–15, not live endpoints.
Examples are synthetic and contain no secrets. `invalid.json` contains intentionally rejected
payloads. `unicode.json` is shared by Java, TypeScript and Python checks.

Schema `maxLength` counts Unicode code points; `x-maxUtf16` is an additional required application
limit in Java/JS/Python. Selected text: 4000 UTF-16 units, surroundings: 512 each, caret fingerprint:
32 each. Snapshot maximum: 24576 UTF-8 bytes; context maximum: 32768 stored bytes. Relative-position
base64: 1024 characters each; state vector: 65536. Future instruction: 8000 units, 12 source versions,
6 analysis outputs, 32 proposal blocks, bounded history: last 8 completed turns / 12000 UTF-16 units
and shared 16000-token context budget, trimmed oldest first with explicit truncation metadata.
Identifiers/counts must be JSON-safe integers (<= 2^53-1). Surrogate pairs cannot be split by offsets
or excerpt boundaries. Hashes use UTF-8 SHA-256 of selected text (U+FFFC atoms, newline between text
blocks); analysis hash uses `analysisId:executionId:outputId`. Caret hash uses `before32 + NUL + after32`.

Current request `clientRequestId` is scoped to workspace/document/caller. An exact replay returns the
same context; changed schema, target, scope, revision, epoch, sequence or relative positions with the
same ID returns 409. Future `clientConversationId`, `clientRequestId` for turns and `clientOperationId`
for acceptance similarly include the full normalized versioned payload and scope. First-turn outer
contextId must match inner turn.contextId. A turn references one context and one explicit evidence
scope; follow-ups do not inherit wider evidence access.

Trust classes: USER_INPUT (document selection/instruction), SOURCE_EVIDENCE (authorized immutable
chunk), COMPUTED_RESULT (authorized successful immutable execution), MODEL_EXPLANATION (previous
assistant output). History and user text are untrusted data and never acquire source authority.
Source IDs/chunks and analysis/output references are reconstructed from saved nodes and reauthorized;
clients cannot inject evidence by editing the context response. Citations only name provided evidence.

Errors follow existing RFC 9457: VALIDATION_FAILED 400, FORBIDDEN 403 for insufficient member role,
RESOURCE_NOT_FOUND 404 for foreign/missing resources or revoked membership, CONFLICT 409 with
`reason=NOT_SYNCHRONIZED|TARGET_STALE` for target/sync conflicts (other idempotency/archive conflicts
use CONFLICT), AI_CONTEXT_TOO_LARGE 413, AI_UNAVAILABLE 503 for resolver transport failure. Clients
must keep draft prompts on failures; changed target requires explicit recapture, never a fallback.

Compatibility: no existing question, authoring, execution or conversations v1 schema is widened or
reinterpreted. No legacy `sourceVersionId` represents a problem. Existing analysisResult continues
to reference its exact execution/output. Existing SSE deltas are provisional; completed messages
remain immutable. Native Gemini adapter and sandbox boundary remain unchanged.
