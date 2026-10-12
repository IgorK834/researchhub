# ADR-016: Contextual canvas AI and stable document targets

Status: accepted. Date: 2026-10-09. Implemented: CAI-01–09.

The existing document, AI, analysis and collaboration application boundaries remain authoritative.
Spring authorizes and stores bounded contexts. Gemini in the worker interprets requests; only
ADR-008 sandbox execution produces calculated values. No browser or model can submit an arbitrary
replacement document as an accepted proposal. API keys stay in the worker.

Screen anchors position overlays; logical targets contain stable block IDs, UTF-16 offsets and a
SHA-256 fingerprint. Existing untagged legacy blocks use an explicit structural path, pinned to the
saved revision; they are never silently rebased. Text blocks in lists and table cells are eligible.
Cross-block text ranges use newline separators; inline atoms use U+FFFC. Analysis atoms identify
one saved output; citation atoms identify immutable source evidence. Other block atoms and table
cell/row structural selections are rejected. Empty paragraphs have a real caret and empty context.
UTF-16 offsets may not split a surrogate pair. Fingerprints for carets use 32 units before, NUL,
and 32 units after; excerpts use 512 units per side. Context is user-authored content, not evidence.

For realtime editing clients the caller must supply acknowledged revision, epoch, sequence, state vector
and relative positions. Spring reads projection and binary state under the document lock. A
service-token protected collaboration resolver resolves positions in that frozen canonical Y.Doc,
pins saved projection targets for read-only clients without granting room access,
checks the `default` fragment ancestry and returns block identities and offsets. No room mutation
or broadcast occurs during capture. A deleted target, changed hash, restored epoch or unsaved state
returns a conflict. After a remote insertion, resolve may reanchor to the same identified block and
unchanged text. There is no append-to-document fallback. All context reads reauthorize membership
and references; resolving a target is explicit and never changes the immutable history record.

Contextual turns use ANSWER, EDIT, ANALYZE, SOLVE or CLARIFY. They reserve one active turn per
conversation and advance through durable states; long execution uses persisted status, not an SSE
connection spanning the sandbox. First send atomically creates a conversation and reserves a durable turn;
closing an empty window creates nothing. Closing a running window does not cancel it. Cancellation
is explicit. Existing conversation/question/authoring v1 and SSE remain unchanged.

Flyway V40 extends the existing workspace history with optional document/context origin and a durable
turn queue. Replay identity includes context, instruction, intent, evidence scope and references.
A five-minute interrupted lease before inference is reclaimed with a new fence. V41 records the
start of the paid model stage; expiry after that point fails explicitly without repeating inference. Memory v1 travels in model envelope v3:
six messages / 4096 UTF-8 bytes, with current selected text and explicit saved proposal/block references.
Memory is untrusted data, never S/A evidence. Current membership and immutable versions/executions are
reauthorized; scope narrowing drops historical pairs that rely on excluded evidence. Missing or ambiguous
references ask for clarification. Existing pending proposals and accepted block provenance can be
selected explicitly from the writing and provenance UI. CAI-07–09 add a closed application router and immutable text proposals. The UI sends the explicit
ANSWER/EDIT/ANALYZE/SOLVE/CLARIFY discriminator; it cannot name a provider tool or arbitrary service.

A reviewed proposal is immutable and has a version hash. Acceptance uses an operation UUID and a
server-frozen package, rechecks role, scope, target and epoch, and records a receipt with deterministic
block IDs. A replay returns the receipt; reusing an ID with a changed payload returns 409. Legacy
acceptance uses a document transaction. Realtime acceptance follows ADR-007: candidate Yjs update,
atomic durable snapshot/receipt/provenance commit, then broadcast. V41 stores the frozen patch, proposal version and immutable operation receipt. The service-only
bridge serializes the room, constructs a temporary candidate and obtains Spring’s atomic commit
before applying the committed binary to room clients. It works without a loaded room and recovers
a lost commit/broadcast response by loading the saved receipt and canonical state. These writes
are separate from the read-only context resolver. Local editor undo uses Tiptap/Yjs's existing history.
AI acceptance has a separate conditional compensation operation: only still-matching inserted
blocks can be undone, so collaborator changes cannot be erased by a local undo command.

Role matrix (server authorization remains authoritative):

| Action | Active owner/editor | Active viewer | Archived workspace, any member |
| --- | --- | --- | --- |
| Read document, saved contexts, saved outputs | Yes | Yes | Yes |
| Capture context / ANSWER / CLARIFY | Yes | Yes | No new work |
| Edit, proposal acceptance, compensation | Yes | No | No |
| Prepare dataset analysis / request problem clarification | Yes | No | No |
| Copy selection | Yes | Yes | Yes |

New context endpoints create no model call. Computation is reserved for DATASET (existing immutable
CSV/XLSX inputs) and PROBLEM (future bounded immutable problem input); it never bypasses ADR-008.
Initial PROBLEM scope: arithmetic/unit conversions, one-variable linear/quadratic equations, small
linear systems, explicit physical formulas and function plots on an explicit domain. Missing data
requires clarification; unsupported domains cannot be claimed as verified solutions.

Contracts and limits: [canvas v1](../../contracts/ai/canvas/v1/README.md).
Implementation and verification: [canvas AI](../development/canvas-ai.md).


Current stage boundary: ANALYZE with 1–5 explicitly selected CSV/XLSX versions atomically prepares
one existing DRAFT analysis and links to Analysis Studio for plan review/execution. Automatic chat
execution is CAI-13. SOLVE returns a saved clarification until immutable PROBLEM inputs and sandbox
execution are implemented in CAI-11–12. No fabricated numerical answer or execution ID is published.
Text edit splices support paragraphs/headings within the same structural container. Unsupported
cross-container/code/atom selections fail explicitly before inference. The inverse splice requires
all affected blocks to remain unchanged; edits elsewhere and moved ancestors survive compensation.

## CAI-10–12 extension (2026-10-11)

Semantic inline/display mathematics uses a closed shared AST and generated safe notation in browser, Spring and canonical Yjs. Formula context is frozen with document revision and checked during re-resolution. No legacy bulk document migration is required; math text marks are rejected consistently because the existing Yjs atom transport cannot preserve them.

PROBLEM v2 is an additive analysis workload, with immutable exact problem/context/message input, explicit values/units/REAL domain/assumptions, versioned template/model audit and parent lineage. DATASET v1 remains unchanged. SOLVE saves a scoped problem and requests missing structured input in the existing Studio. The model plans and describes; it cannot provide published numerical values or introduce source identifiers.

Calculation and fresh verification use two independent disposable instances of the existing ADR-008 Docker boundary, fixed AST constructors and readonly frozen JSON. The host binds the verifier receipt to exact hashes/runtime/counts/tolerances and validates transported plot references. Separate execution/computation/verification outcomes preserve safe failures. Immutable finished attempts can be reproduced from the saved runtime without another model call. V42 extends existing persistence; no separate service, broker or CAS network is introduced. Limits and local acceptance scope are normative in ADR-008; full solution packages/insertion/export remain subsequent backlog work.

## CAI-13–15 extension

Dataset turns persist the analysis and execution IDs before entering EXECUTING; recovered observers never enqueue another attempt. Explicit version/sheet/columns supersede ambiguous latest-file selection. Saved PROBLEM solutions are server assembled capabilities after the controlled fresh verifier; the existing v2 sandbox transport remains unchanged. The typed SOLUTION bundle records checked arithmetic separately from NOT_CHECKED interpretation. Calculation proposals extend CAI-09 with saved immutable result atoms, exact step/conversation refs and atomic conditional compensation; proposal reads and previews perform no inference. V43 changes turn/proposal shape and preserves old JSON readers. See [canvas-ai.md](../development/canvas-ai.md) and the closed solution/reference/provenance contracts.
