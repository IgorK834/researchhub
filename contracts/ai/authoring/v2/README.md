# Canvas authoring v2

`authoring.schema.json` defines the deployed proposal, acceptance, conditional undo, receipt and
discriminated chat result. Shared fixtures are checked in Java, Python and TypeScript.
The provider still uses the bounded plain-text authoring result v1; the new `canvas-edit:2` prompt
and memory envelope do not widen that schema. Spring builds an allowlist of paragraph blocks and
resolved citation atoms. A model never supplies HTML, editor JSON, block IDs or executable tools.

An EDIT at a caret inserts; a text EDIT replaces, except an explicit add/insert instruction which
inserts at the beginning of the captured range. A follow-up to a pending proposal retains its mode
and context and supersedes it atomically. An accepted reference captures its current generated
blocks by provenance, including subsequent human edits; a removed or compensated target conflicts. Source-backed drafting retains the DRAFT citation requirement.
Own-text edits are marked as requiring evidence for new claims. Replaced citations/comment anchors
are disclosed in review. Surviving inline marks and atoms are retained exactly.

Public routes under `/api/workspaces/{workspace}/documents/{document}/ai`:

- `GET /proposals/{id}`: immutable package plus current operation/compensation state.
- `POST /proposals/{id}/accept`: `clientOperationId` and exact `versionHash`.
- `POST /proposals/{id}/reject`: idempotent rejection of pending proposals.
- `POST /operations/{id}/undo`: a new `clientOperationId` compensates an accepted operation.

Acceptance/undo are authorized server operations. A UUID reused with different input returns 409.
A committed replay returns the receipt without adding blocks. After a transport failure, retry the
same UUID. The canonical Yjs write commits binary state, projection, receipt and provenance together
before broadcast. It also works without an open room. Epoch, role and scope are rechecked at commit.
Undo restores only the still-matching contiguous splice; any later edit inside it causes a conflict.
Different paragraphs and moved ancestors are preserved. Cross-container selections, code blocks,
analysis atoms and structural table selections require a new paragraph/text target.

Limits: 16 paragraphs, 12000 UTF-16 units total, 12 citations, 262144 stored proposal/patch bytes.
The cursor chat uses the same persisted proposals as full history. Preview never enters editor state.
Authoring makes one outer provider attempt; native bounded schema repair remains inside the provider.
Five-minute expired leases after a model call fail explicitly and cannot trigger another paid call.

ANALYZE with 1–5 explicit CSV/XLSX versions prepares one saved analysis through the existing analysis
application API. It links to Analysis Studio for plan review/execution; automatic chat execution is
CAI-13. SOLVE now saves an immutable PROBLEM v2 with exact context/message and selected formula, returns its analysisId and requests explicit missing inputs in Studio. No computed values are claimed before actual isolated execution and fresh verification.

CAI-15 saved calculation proposals additionally contain `calculation`, a closed v2 package of authorized exact output references. They may have null turnId/generation/modelContext; a model request is never invented for deterministic saved output reads. Ordinary text proposals still require these identities. FULL/TABLE/CHART selection and block structure are described by [document-block v2](../../../analysis/document-block/v2/README.md). Accept/receipt/conditional undo/version hash retain the existing CAI-09 semantics.
