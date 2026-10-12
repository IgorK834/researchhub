# Canvas AI (CAI-01–18)

Architecture: [ADR-016](../adr/ADR-016-contextual-canvas-ai.md). Wire contracts:
[canvas v1](../../contracts/ai/canvas/v1/README.md) and [conversations v2](../../contracts/ai/conversations/v2/README.md). This release provides the context menu and
immutable authorized context capture/re-resolution, durable contextual conversations, a cursor chat
and bounded follow-up memory. CAI-07–09 add typed intent routing, saved text proposals and atomic
acceptance/compensation in legacy and realtime documents. The current deployed proposal contract is
[authoring v2](../../contracts/ai/authoring/v2/README.md).

Right-click or Shift+F10 inside the editor opens Canvas actions. Clicking within a selection preserves
it; clicking outside selects the clicked caret/atom. Arrow keys, Home/End and Enter operate the menu;
Escape restores the editor focus. Inputs, textareas and overlays retain their own native menu.
The screen anchor follows scroll and stays inside the visual viewport, including zoom. Viewer menus
only offer Copy and Ask AI. Clipboard reads/writes require a gesture; failure retains content and
shows the browser shortcut. Cut deletes only after successful clipboard write and matching selection.
Paste uses the editor's native schema parser and paste plugins, preserving supported HTML/citations,
refreshing block IDs and imported provenance; plain-text-only browsers use the same native text path.
Undo/redo invoke Tiptap's current history (Yjs when realtime is active).

Ask AI opens a cursor-anchored chat and context review and waits for successful autosave or a persisted realtime acknowledgment.
Opening an empty chat does not create a conversation or invoke a model. The first send atomically
creates its workspace conversation and reserves a durable turn. The context response is a bounded server snapshot;
no full document or browser-provided snapshot is sent to an AI worker.

All routes below are workspace/document scoped, authenticated and `private, no-store`:

- `POST /api/workspaces/{workspaceId}/documents/{documentId}/ai/contexts`: capture.json -> context.json.
  CSRF required; active workspace/document, any content reader including viewer.
- `GET .../ai/contexts/{contextId}`: immutable history read, with current membership/reference checks.
- `POST .../ai/contexts/{contextId}/resolve`: validate/reanchor current target; returns Snapshot.
  CSRF required. Does not update the captured context or document.

Flyway V39 adds workspace-aware context foreign keys, a caller-scoped idempotency key and a document
history index. Context and saved request are immutable. No document contents or historical versions
are rewritten by this migration. Legacy blocks without blockId remain readable: their explicit tree
path is valid only for the captured revision. Identified legacy blocks can survive unrelated saves;
realtime blocks additionally use canonical Yjs positions to survive inserts before the range.

`researchhub.collaboration.internal-url` / `COLLABORATION_INTERNAL_URL` defaults to
`http://127.0.0.1:8091`. In containers set it to `http://collaboration:8091`. Its protected
`POST /internal/canvas/resolve` accepts only Spring's persisted binary state, relative positions and
optional capture state vector, or a validated saved projection target for read-only clients, using X-Collaboration-Service-Token. It runs a read-only temporary
Y.Doc, verifies fragment ancestry and rejects deleted/foreign types. Backend request timeout: 5s;
internal request limit: 5.5 MB; snapshot input limit matches the existing 4 MB Yjs boundary. Resolver
failures never cause document mutation. Existing websocket/public URL stays separate.

Run checks:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend test -- --runInBand
npm --prefix frontend run build:realtime
npm --prefix collaboration run build
npm --prefix collaboration test
(cd ai-worker && uv run --frozen pytest tests/test_canvas_contracts.py)
(cd backend && ./mvnw verify)
```

From the `backend` directory, `CANVAS_BROWSER_TESTS=true ./mvnw -Dtest=CanvasApiIntegrationTest test` also launches the built
frontend in Chromium, the deterministic worker and a real collaboration sidecar against Spring/Testcontainers PostgreSQL.
The browser exercises menu, keyboard/focus, viewer, context capture, two replicas, reanchoring and
stale targets, local Yjs Undo/Redo preserving remote edits, and layout at 360/768/1440 px. On macOS it
uses installed Chrome; CI installs Playwright Chromium. An explicit `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
can select another installed Chromium. The test worker serves the public model configuration;
context capture does not invoke inference or computation, so this flow has no sandbox or Gemini requirement. CI runs this browser test in `mvn verify`. Downstream computation E2E must additionally use the worker and ADR-008 runner.

## Contextual conversations (CAI-04–06)

Wire fixtures and compatibility: [conversations v2](../../contracts/ai/conversations/v2/README.md).
Flyway **V40** adds optional origin to the existing `ai_conversations` and a durable `canvas_turns`
operation queue linked to existing `ai_messages`. Legacy conversation history and SSE v1 remain
readable; origin/turn fields are omitted for old records. History pagination remains bounded.
First creation and message reservation share a transaction. A unique caller/workspace client identity
handles concurrent replicas and lost HTTP responses. A conflicting payload returns 409. Replays
return saved status, append no messages, invoke no provider and consume no additional inference quota.

New authenticated workspace routes (CSRF on POST, `private, no-store`):

- `POST /ai/conversations/contextual`: Canvas FirstTurn, returns 202 + durable turn/conversation IDs.
- `POST /ai/conversations/{conversationId}/turns`: Canvas Turn, returns 202. Context must belong to
  the same document. Every turn carries an explicit evidence scope; empty lists select none.
- `GET /ai/conversations/{conversationId}/turns/{turnId}`: durable status/result/reference metadata.
- `POST /ai/conversations/{conversationId}/turns/{turnId}/cancel`: explicit, idempotent cancellation
  by the turn author. Closing the popover, leaving the page or losing a stream never cancels work.
- Existing conversation GET/list exposes the origin and bounded typed turn statuses with saved
  assistant responses. Backend reauthorizes current membership, document contexts and saved evidence.

The PostgreSQL dispatcher processes one claimed turn per tick (default **1 second**). Enable/disable
with `researchhub.ai.canvas.dispatcher.enabled` (default true); tune the interval using
`researchhub.ai.canvas.dispatcher.fixed-delay`. An interrupted PLANNING lease before inference can be claimed after
**5 minutes** using a new fence. V41 records the start of inference; an expired paid stage fails
explicitly and requires a deliberate new turn rather than another automatic provider call. Late completion cannot overwrite a cancelled or reclaimed operation.
The UI polls the existing shared history cache every 2 seconds while messages are pending, and stops
when work finishes. A second simultaneous turn is rejected; a failed terminal turn stays in history.
A deliberate new attempt uses a new clientRequestId. Safe error codes never carry provider details.

The popover follows a virtual caret anchor, clamps to the viewport and fills the narrow viewport as
an accessible sheet. Escape closes and returns focus. Inputs keep their native context menu.
The composer retains a local draft until reservation. Retry keeps the exact request and both IDs.
The document title, pinned target, evidence versions and result selection are visible. “Open full
chat” navigates with the same conversation ID; workspace history can resume after reload. Changing
context explicitly recaptures the editor selection inside the same conversation. Merely moving a
cursor cannot change a saved turn's context. Scope changes affect only subsequent turns.

Viewers can ask questions and explain saved results. EDIT/ANALYZE/SOLVE commands require editor
permission on the server. EDIT creates a saved reviewable proposal. ANALYZE explicitly selects 1–5 immutable
CSV/XLSX versions, sheets and physical column indices, then plans and executes through the existing dataset services.
Missing datasets/sheets/columns save a typed clarification. Legacy requests without datasetInputs still prepare the old DRAFT handoff. SOLVE saves an immutable PROBLEM input with the document/message
origin and links to Studio for explicit parameters, units, domain and controlled computation.
The chat saves analysis/execution IDs before polling. Closing, reload, expired observer leases or opening Studio never re-enqueue that execution.

The worker accepts a **v3 context envelope**, wrapping the existing v1 request and S/A evidence.
Untrusted memory is separate from evidence: USER_INPUT / MODEL_EXPLANATION only; six messages and
4096 UTF-8 bytes maximum. Selection is at most 4000 UTF-16 units, surroundings 512 each, instruction
8000. The complete user JSON, evidence, memory, framing and reserved completion consume the existing
conservative token budget. Truncation is recorded with a memory hash and included/omitted counts.
Historical message pairs are excluded after scope narrowing; old citations/snippets are never
copied as current evidence. Each explicit immutable source version is reauthorized and ranked only
within the selected versions. Saved analysis outputs retain the exact execution/output IDs.
The trusted provider policy frames the whole memory as data, and output validation still permits
only actual current S/A citation labels. No memory value can supply a system role or tool capability.

“Explain this proposal in chat” in the writing panel and “Explain accepted text in chat” in provenance
select an explicit saved proposal and its cited versions. Saved conversation history offers “Use this
proposal as context”; selecting it affects the next turn and preserves the conversation identity.
Explicit existing authoring proposal IDs resolve through the authoring module. Pending proposals
provide bounded untrusted proposal text, subject to the new evidence scope. Accepted proposals use
recorded block identities and the current saved text, including later human edits. Missing/deleted
blocks cause a conflict. Ambiguous, foreign, old or scope-excluded references ask for clarification;
there is no fallback to a random selection or document end.

Browser verification requires both editor modes to be built:

```sh
npm --prefix frontend run build:realtime
RESEARCHHUB_COLLABORATION_ENABLED=false npm --prefix frontend run build -- --output-path dist-canvas-legacy
(cd backend && CANVAS_BROWSER_TESTS=true ./mvnw verify)
```

`canvas-chat.cjs` runs Chromium -> production Webpack frontend -> Spring -> Testcontainers PostgreSQL
-> the real deterministic Python worker. A real PDF is uploaded, parsed and indexed before the user
selects its immutable version. The scenario verifies cursor selection/focus, no empty conversation,
360/768/1440 layouts, closing running work, workspace resume, two turns with one conversation,
reload without regeneration and preserved generation IDs. It also generates a real authoring proposal
and opens an explicitly referenced follow-up from the writing UI. This release performs no sandbox workload.
Screenshots and safe browser receipts are written to `backend/target/canvas-chat-*.png` and
`canvas-chat-browser.log`; CI builds both variants, executes both Canvas suites and retains screenshots.

## Baseline verification (CAI-04–06) — 2026-10-10

CAI-04–06 are implemented on top of CAI-01–03. Shared fixtures validate typed commands, durable
status and the v3 memory envelope in Java, TypeScript and Python. V40 is tested both on a fresh
PostgreSQL database and by upgrading historical V21 analysis evidence through the current schema.
Old conversation fixtures remain readable without origin or typed turns.

| Layer | Line coverage | Branch coverage |
| --- | --- | --- |
| Spring Canvas application | 99.52% | 86.79% |
| Canvas REST API | 100% | No branches |
| PostgreSQL / HTTP adapters | 98.94% | 85.71% |
| Saved document targets | 98.85% | 81.45% |
| Model gateway / grounded context | 97.87% | 85.02% |
| Shared Canvas conversation hook | 100% | 89.47% |
| Shared mini/full chat | 96.36% | 88.80% |
| Context capture / review | 89.09% | 100% |
| Worker AI module | 98.05% | 92.76% |
| Worker context envelope | 99.31% | 97.22% |
| Worker safety framing | 100% | 100% |

Independent 80% gates and existing gates pass. Frontend: **1151 tests**; worker: **667 tests**.
Backend regression: **1206 passing scenarios**, with **11 existing unrelated opt-in skips**, combining
full regression with final corrected quota-class and Canvas reruns. The existing analysis quota test
now freezes its test clock so a minute boundary cannot reset the quota during its burst of requests.
Final Maven verification and every existing coverage gate pass. Both Canvas browser suites are enabled;
no Canvas scenario is skipped. They exercise the real styled frontend, Spring, PostgreSQL, Python
worker and (for realtime targets) collaboration sidecar. The worker uses its deterministic provider.
No new computation is performed by these tasks; sandbox execution belongs to the downstream cards.

Tests cover concurrent first-send/replay and conflicting payloads, CSRF, bounded paging, lease
reclamation and late-response fencing, explicit cancellation, membership revocation before
publication, safe provider failures, narrowed evidence scope, prompt injection and missing references.
Existing authoring proposals and accepted blocks are checked through real APIs, including subsequent
human edits and deletion. The browser also verifies explicit proposal selection from the writing UI.
Responsive screenshots were inspected at 360/768/1440 px; mobile send controls stay in the viewport,
and the document selection toolbar is hidden while the chat is open.

TypeScript typecheck, ESLint, Prettier, production builds for both editor modes, CI selection tests
(18 cases), worker coverage gates and the static analysis execution boundary pass. Existing Webpack
bundle-size warnings remain. The browser runs with zero CSP violations and records saved generation
IDs to prove that reload does not repeat inference.

Evidence is generated under `backend/target/`: `canvas-context.png`, `canvas-menu-*.png`,
`canvas-e2e.png`, `canvas-chat-360.png`, `canvas-chat-768.png`, `canvas-chat-1440.png`,
`canvas-chat-history.png`, `canvas-chat-proposal.png` and `canvas-chat-browser.log`.
CI executes both suites and retains `canvas-*.png` as a build artifact.


## Typed proposals and atomic application (CAI-07–09)

The cursor composer has an explicit Action selector. Its closed discriminator selects an existing
application workflow; the model cannot choose Java services, resource IDs or executable tools.
The durable turn reaches `PROPOSAL_READY` only after schema/identity/evidence validation and a
transactional save. Invalid output becomes `AI_OUTPUT_INVALID`; a manual new turn may retry it.
`canvasResult` is additive to history, preserving the existing grounded question response contract.
No database transaction spans model inference. Authoring makes one outer provider attempt with the
existing native bounded schema fallback/repair and HTTP deadlines.

An empty caret is a valid writing target. Insertion in the middle of a paragraph splits its sides
without losing text or marks. A selected text rewrite replaces only that range. The server creates
plain paragraph blocks with deterministic IDs and resolved citation atoms. Source-backed DRAFT
still requires citations; own-text writing warns that new claims require evidence. Review discloses
selected citation removal and possible comment-anchor shortening. Comment records are retained.
Selections across structural containers, code blocks and analysis atoms require recapture.

A pending proposal follow-up retains its pinned target/mode and atomically supersedes the old version.
An accepted proposal or provenance operation reference uses current generated blocks and their current
human-edited text. Removed/compensated blocks cause a conflict, without a guessed insertion point.
Preview and rejection leave editor state, autosave and local undo history unchanged. Acceptance uses
only the saved version hash and a stable client operation UUID. Write controls wait for saved state.
Legacy adoption refreshes the committed revision without scheduling a second autosave.

New authenticated, scoped routes (CSRF on writes; `private, no-store`):

- `GET /documents/{documentId}/ai/proposals/{id}`: saved package, state, acceptance and compensation IDs.
- `POST .../proposals/{id}/accept`: exact `versionHash` plus `clientOperationId`.
- `POST .../proposals/{id}/reject`: idempotent pending rejection.
- `POST .../operations/{id}/undo`: conditional compensation with a new `clientOperationId`.

Flyway V41 freezes proposal payloads and completed operation receipts. Legacy application locks the
document and saves splice, history, provenance and receipt together. Realtime preparation freezes the
operation in a short transaction, then calls the protected `/internal/canvas/apply` bridge outside it.
The sidecar serializes the room, loads the canonical state, applies a candidate-only Yjs diff and calls
Spring’s protected `ai/commit`. Binary snapshot, JSON projection, proposal state, receipt and provenance
commit together before any accepted update is broadcast. A lost response is retried with the same UUID;
a saved receipt repairs the commit/broadcast gap without inserting twice. A closed room is supported.
Epoch, current role, revocation and evidence scope are rechecked before commit. Legacy PATCH remains
forbidden after Yjs activation. A rejected durable write leaves the document/provenance unchanged.

Compensation checks the current affected splice against the recorded accepted nodes. It restores only
that splice and records `AI_UNDONE`; unrelated paragraphs and moved ancestors are preserved. Later
changes inside the affected nodes conflict and remain in the document. Completed compensation is
visible after reload and cannot execute a second time.

Browser verification includes `CanvasProposalApiIntegrationTest` (enabled by the same
`CANVAS_BROWSER_TESTS=true` flag). `canvas-proposals.cjs` runs both production builds through Chromium,
Spring, PostgreSQL, the real Python worker and the collaboration service. It checks preview/reject,
exact insertion, compensation, saved history, a second Yjs client, preserved remote edits, responsive
layouts at 360/768/1440 px and zero CSP violations. Evidence: `canvas-proposals-{legacy,realtime}-*.png`
and corresponding logs under `backend/target/`. The deterministic model fixture is visibly labelled.


## Verification of CAI-07–09 — 2026-10-10

The complete regression and corrected migration/browser suites leave **1233 backend scenarios
passing**, with **11 existing unrelated opt-in skips**. Final Maven `verify` passes every coverage
gate. All three Canvas browser suites run; none is skipped. Production builds for both editor modes,
TypeScript, ESLint, Prettier, 18 CI-selection tests and the static sandbox execution boundary pass.

| Layer | Line coverage | Branch coverage |
| --- | --- | --- |
| Spring Canvas application | 97.70% | 82.27% |
| Canvas REST API | 100% | 100% |
| PostgreSQL / HTTP adapters | 96.50% | 84.09% |
| Saved document targets and splices | 98.70% | 87.26% |
| Spring collaboration | 94.92% | 81.03% |
| Shared mini/full chat | 93.44% | 86.52% |
| Proposal review | 100% | 92.85% |
| Proposal HTTP client | 100% | 100% |
| Node collaboration service | 100% | 94.81% |

Frontend: **1160 tests passing**; worker: **670**, total coverage **97.65%**, all worker module gates
passing; collaboration: **40**, including the two-client lost-commit response and no-loaded-room cases.
The full backend regression is followed by the affected migration, source and Canvas suites with
browser checks enabled; coverage includes both runs. Existing Webpack bundle-size warnings remain.

Failure cases cover a mismatched model request ID (`AI_OUTPUT_INVALID` and an explicit new attempt),
expired paid leases, invented IDs/intents, supersession, narrowed evidence, stale targets, reuse of
operation identities, epoch changes, role revocation immediately before commit, forged projections,
invalid binary encoding, conflicting sequence and repeated conditional undo. An injected PostgreSQL
provenance failure rolls back snapshot/proposal/receipt/history; retrying the same operation recovers
one insertion. Browser receipts for both modes record successful review, acceptance, compensation
and zero CSP violations. Responsive screenshots were inspected with the proposal controls visible.

## Structured mathematics and scientific problems (CAI-10–12)

The editor toolbar's **Insert formula** accepts a small explicit grammar: numbers, Latin symbols, + - * / ^ = and sqrt/sin/cos. Inline/display atoms carry the shared [normalized AST](../../contracts/document/math/v1/README.md), generated notation and readable accessibility text. Browser, Java and collaboration reject raw TeX/HTML/macros and enforce the same bounds. KaTeX 0.19.0 renders with trust:false, strict:error, maxExpand:100, maxSize:10 and fresh empty macros. Renderer failure retains visible escaped text. Clipboard HTML, native text, database saves, tables, neighboring citations/comments and Yjs retain supported semantics. Math atoms themselves have no text marks because the current Yjs transport loses those marks; validators reject marked math. Existing documents need no bulk rewrite. A checked-step reference is accepted only when a scoped successful PROBLEM execution contains that exact AST and CHECKED arithmetic receipt.

Canvas snapshots additionally freeze up to eight selected formulas. Their semantics participate in re-resolution and pending capture identity even when the text is the same object marker. Empty formula lists are omitted, preserving old snapshots. Selected formula text in follow-up memory is explicitly untrusted user input and remains within the existing 4000-character budget.

Choose **Solve a problem without dataset** in New analysis, or use SOLVE in the cursor chat. SOLVE saves the selected text/formula, exact immutable document context and originating user message, then links to Analysis Studio for required explicit input. Studio accepts canonical decimal strings, units, REAL domain, expected formulas and assumptions; missing values/units/domain/symbol declarations are saved as WAITING_FOR_INPUT and do not invoke planning or computation. Changed input creates a new analysis with parent lineage. Planning audits preserve the exact template/request/model/candidate. No synthetic CSV, source ID or provider-supplied numeric result is introduced.

The [v2 workload contract](../../contracts/analysis/computation-plan/v2/README.md) accepts original DATASET v1 requests unchanged, explicit DATASET v2 with the same required inputs, and PROBLEM v2 without dataset inputs. Flyway V42 adds the discriminator and immutable problem snapshots/plans/audits, separate durable execution attempts and PNG artifacts with workspace composite keys. Reads and mutations remain authenticated, scoped and CSRF protected; permission is checked again before publication. History lists are bounded to the newest 100 attempts; exact record/artifact/reproduction lookups remain available by ID. Interrupted planning/running attempts fail without automatically repeating a costly call.

**Calculate in sandbox** plans once, then dispatches the frozen input/plan to image 1.2.0 (SymPy 1.14.0, mpmath 1.3.0). The fixed entrypoint constructs expressions from the closed AST without eval/sympify/parse_expr or generated imports. Supported scope is REAL arithmetic, explicit SI conversion, sqrt, sin/cos, one rational polynomial unknown of degree 1–4 and up to 201 plot points. Matrices and general symbolic transformations are rejected. Values, steps and numeric plot data are independently recomputed in a second fresh container using the exact first phase image ID. The trusted host checks the receipt, hashes, tolerance, counts and chart/table binding; failures publish no result. Computation and arithmetic verification have separate statuses. Physical interpretation and assumptions remain explicit, separate from arithmetic checks.

**Reproduce frozen run** uses saved input/plan/image and contacts no model. Results, PNG, steps, receipts and lineage survive refresh. The [two-phase protocol](../../contracts/analysis/execution/v3/README.md) and [ADR-008](../adr/ADR-008-analysis-execution-boundary.md) retain the existing network/mount/resource/cleanup limits. Local technical review is recorded in commit a70ee1c; cloud parity remains deferred by the existing boundary policy.

Full native equation/package exports remain CAI-16. Current formula exports retain readable/source fallback through the existing portable Java renderers. Validation commands and actual local evidence: [canvas-scientific-validation.md](canvas-scientific-validation.md).

## Dataset execution, saved solutions and atomic packages (CAI-13–15)

The cursor chat's **Analyze a dataset** picker selects an exact dataset version, sheet and physical columns without defaults. The bounded preview supplies structure to the planner; the sandbox reads all bytes of that immutable version. ANALYSIS quota admission uses the existing per-user/workspace limits for planning and execution (defaults 10/30 per minute), alongside conversation LLM admission. Plan inference is fenced once per saved turn. An expired paid planning lease resumes only if its plan was already durably saved; otherwise it fails explicitly. EXECUTING leases only observe the saved execution. Replacing the upload, reloading chat or opening Studio cannot substitute latest bytes or create a second run. Errors retain the failed exact execution and its Studio link; no numeric result is fabricated. Cancel question stops the chat turn; an execution already enqueued remains available in Studio.

PROBLEM successful executions additionally save a typed [SOLUTION bundle](../../contracts/analysis/execution/v3/SOLUTION.md), assembled after fresh controlled verification. GET `/api/workspaces/{w}/analyses/{a}/executions/{e}/solution` is a read-only scoped capability. It persists statement, explicit values/units/domain, unknowns, bounded AST steps and SI substitutions, numeric results, tolerance, exact input/plan/candidate/image/runtime/code hashes and verification receipt/version. The runtime recomputes steps, substitutions and units; Java verifies structure/identity and never performs CAS. Model summary, assumptions and physical interpretation explicitly remain NOT_CHECKED. A follow-up can select the saved solution or plot as computed A evidence without inventing a sourceVersionId; source theory B keeps its independent citations.

**Insert saved package** chooses an exact execution and FULL, TABLE or CHART. POST document `/ai/proposals/calculation` saves a deterministic preview and leaves the document untouched. FULL PROBLEM contains frozen inputs, every checked step, result, unchecked interpretation and optional numeric plot table/chart. FULL DATASET contains its saved table/chart/text outputs. The shared CAI-09 accept/receipt/conditional undo applies one atomic splice at the captured target and rechecks every reference. Foreign/missing output, changed target or revoked access cannot partially insert. V43 permits these proposals without an AI turn and persists linked proposal IDs in conversation history.

[Document reference v2](../../contracts/analysis/document-block/v2/README.md) retains stable package block IDs and exact workload/analysis/execution/output/step/conversation IDs. The authenticated server artifact route supplies PNGs. Reload/history uses saved AST/values and performs no inference. Inputs and numeric atoms are read-only; captions are explicitly human and not verified. To change values, create a new input/execution and explicitly Update reference. Replacing an atom with a human formula/prose carries ordinary human provenance, never the old arithmetic receipt. Existing four-field dataset references, TABLE/CHART/TEXT v1/v2 and old PROBLEM executions remain readable. Old runs lacking SOLUTION offer explicit reproduce to create a new bundled execution.

## Export, recovery and evaluation (CAI-16–18)

Native solution packages and inline/block math export through the existing frozen Java pipeline: [report contract and rendering](report-export.md#controlled-mathematical-solutions-cai-16). Contextual quota admission, bounded provider transports, safe lease expiry/cancellation, Polish recovery messages and polling backoff are documented in [configuration](configuration.md#contextual-canvas-budgets-and-recovery-cai-17) and [stage diagnostics](ai-diagnostics.md#contextual-stage-latency-cai-17). Expanding a proposal refreshes the superseded version in the UI; saved history remains immutable.

The native unit registry additionally supports `A`, `mA`, `V`, `ohm`, `kohm`, `W`, `mW`, with a fourth electric-current dimension. The 43-case fixed suite independently checks Ohm's law (6 mA/72 mW), polynomial roots, real-domain formulas, sampled I(U), missing inputs and adversarial context. For x+y=5, x−y=1, the supported case explicitly supplies the elimination formulas `(sum+difference)/2` and `(sum-difference)/2`; it checks both original equations. A general multi-unknown symbolic solver remains outside this bounded AST runtime. Physical interpretation is NOT_CHECKED.

Run `ai-worker/.venv/bin/python scripts/demo/canvas-suite.py` for all layers and real browser/Docker evidence. Add `--live` explicitly for Gemini quality and token/cost measurements using only the worker key. See [dated validation and matrix](canvas-export-recovery-evaluation.md); skipped required cases cannot pass the runner.
