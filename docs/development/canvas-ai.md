# Canvas AI (CAI-01–06)

Architecture: [ADR-013](../adr/ADR-013-contextual-canvas-ai.md). Wire contracts:
[canvas v1](../../contracts/ai/canvas/v1/README.md) and [conversations v2](../../contracts/ai/conversations/v2/README.md). This release provides the context menu and
immutable authorized context capture/re-resolution, durable contextual conversations, a cursor chat
and bounded follow-up memory. Intent routing and proposal application are the subsequent backlog tasks.

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
`researchhub.ai.canvas.dispatcher.fixed-delay`. An interrupted PLANNING lease can be claimed after
**5 minutes** using a new fence. Late completion cannot overwrite a cancelled or reclaimed operation.
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
permission on the server and currently return a saved CLARIFICATION pointing to the existing
writing/analysis tools. CAI-07–09 implement their routing/application; this release never fabricates
proposal/execution links or claims that a new calculation was run.

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

## Verification — 2026-10-10

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
