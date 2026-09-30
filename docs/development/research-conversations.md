# Research conversations (RH-113–RH-115)

The document page includes a research panel beside the editor. Workspace content readers, including
viewers, can load shared conversations, ask a question against all READY sources or an explicit
selection, retry transient failures and follow citation chips to a source's processing version,
extraction unit and PDF page. The server always checks membership and source ownership; a removed
member gets the same 404 as an unknown workspace. Conversations do not grant separate access rights.

## Public contracts

All routes are relative to `/api/workspaces/{workspaceId}/ai/conversations`. Reads require the signed-in
session. Writes also require the existing CSRF token. Responses are private/no-store. See the canonical
[Java/React fixtures](../../contracts/ai/conversations/v1/README.md).

| Method / path | Body or query | Result |
| --- | --- | --- |
| POST collection | `{ "title": "Lecture research" }`; optional title defaults to Research conversation, max 160 code points | 201 conversation |
| GET collection | `offset=0&limit=25`; maximum limit 50 and offset 100000 | `{items, nextOffset}` ordered by latest activity |
| GET `/{conversationId}` | optional `beforeSequence`, `limit=25` (1–25 turns) | `{conversation, messages, nextBeforeSequence}` |
| POST `/{conversationId}/messages` | `{clientRequestId, question, selectedSourceIds?}` | complete `{user, assistant}` |
| POST `/{conversationId}/messages/stream` | same body | SSE events; errors before opening use ordinary ProblemDetail |

`clientRequestId` is a client UUID identifying one turn. Questions and selections use the
[workspace-question bounds and semantics](workspace-questions.md): up to 2000 UTF-16 units, 100 distinct
source UUIDs, null/omitted = all, [] = none. Reusing an identity with different text/scope returns 409.
A completed retry returns the same saved assistant without a model call or duplicate rows. A live
pending retry returns 409; only the original author may retry a failed/abandoned turn. No automatic
model retry happens in the UI. Refresh history after a transport interruption before explicitly retrying.

Conversation history returns messages in ascending sequence order. Odd/even sequence pairs are reserved
at submission so concurrent questions keep their original order; responses can arrive out of order.
Pagination selects entire turns, including the answer when present. `nextBeforeSequence` is the cursor
for an older page. Each message includes identity, request identity, role, status, author, visible
content, optional selected IDs, response, safe error code, creation time and completion time.
An assistant's `response` is the full existing question envelope with server-owned provenance,
model/provider identity, template ID/hash, usage and generation audit identity. No evidence returns a
complete explicit insufficient-evidence response with no model call or model/usage metadata.

## Persistence and privacy

Flyway V16 creates `ai_conversations` and `ai_messages`. The composite workspace/conversation foreign
key prevents cross-workspace messages; unique request/role and sequence keys enforce retry identity.
USER rows start PENDING. Publishing an answer updates that user and inserts a COMPLETED assistant in
one transaction. Database checks reject pending/partial assistants. Failure records a safe code on
the user; no assistant fragment is stored. Each attempt has a fresh lease UUID, so an expired/cancelled
attempt cannot overwrite a later retry. A 5-minute stale pending lease becomes ABANDONED when history
is read, covering a process restart. Normal stream deadlines are shorter than this lease.

Store only product-visible questions, selected IDs, final answers, citation references, timestamps,
model/provider identifiers, immutable template identity/hash and bounded token telemetry. Typed gateway
results exclude hidden reasoning, credentials, raw provider bodies and prompt context. Questions may
contain private research data: apply the same workspace access/retention policy as other workspace
content. Deleting a workspace cascades its conversations/messages. This change introduces no logging
of question/answer text and no new external persistence. Citation snapshots survive a source deletion
or reprocessing; opening an unavailable/stale source uses the existing preview's safe state.

The existing V15 generation audit remains compatible. Old stateless questions cannot be backfilled:
that audit deliberately stored hashes rather than the raw question. V16 is additive and does not
modify prior migrations. Deploy it before exposing these endpoints/panel. A rollback can disable the
panel/routes while retaining historical rows; do not drop history as a rollback step.

History is not model memory. Every question independently retrieves current authorized source chunks;
transcripts are not injected as system instructions or evidence. The Spring modular monolith owns
history/authentication and composes the provider-neutral question use case. The Python boundary and
pinned dependencies are unchanged. As with current source/editor modules, these product APIs use the
local profile; cloud Spring activation remains the existing deployment scaffold.

## Streaming and cancellation

The decision is documented in [ADR-004](../adr/ADR-004-research-event-streaming.md). SSE uses an
authenticated **POST with fetch**, rather than EventSource, so the request body, CSRF and AbortSignal
remain under the shared API policy. No collaboration WebSocket is involved. A stream has monotonically
numbered event IDs; IDs are for ordering, not reconnect/resume cursors.

| Event | JSON payload |
| --- | --- |
| started | `{conversationId, user}` after the visible question is committed |
| retrieval_completed | `{chunkCount}` (0–12) after scoped retrieval |
| delta | `{text}` containing a slice of the complete validated persisted answer |
| completed | `{user, assistant}` including citations and provenance; terminal |
| error | `{code, detail, retryable}` using safe application codes; terminal |

This initial implementation streams progress events immediately. The current synchronous model adapter
returns a structured response as a whole. Answer deltas therefore begin **after validation and complete
persistence**, not while the model is generating tokens. A provider token-streaming port can be added
later without changing conversation identity, final publication, events or workspace checks. Never
persist deltas, hidden reasoning, or unvalidated provider content as an assistant message.

A heartbeat rechecks membership and flushes a keepalive comment. Membership is checked again before
answer frames. Disconnects/stop/timeout cancel event delivery. The synchronous provider has no
cancellation port, so its already-running bounded HTTP call may finish; checkpoints then safely
abandon its result without inserting an assistant. The generation audit may record the completed
call/usage. If final persistence already committed before a disconnect, history retains that complete
answer and a retry replays it. This also covers a disconnect after commit but before completed delivery.

Timeout is scheduled while the emitter is writable so it can emit a machine-readable error; a servlet
timeout is only the fallback. Capacity is held until an abandoned provider call exits, bounding active
work. Proxy buffering is disabled by response headers. Configure proxy read/idle timeouts above the
application timeout and allow POST SSE; heartbeats keep idle connections visible. The client bounds
UTF-8 parsing to 1 MiB buffered frame and 4 MiB total, rejects malformed/truncated events, closes its
reader at a terminal event and aborts on workspace/conversation navigation. The UI hides cached history
when its fresh authorized request fails.

## Configuration and tests

Server-only values under `researchhub.ai.conversations.stream`:

| Environment variable | Default | Bounds |
| --- | --- | --- |
| `AI_CONVERSATION_STREAM_MAX_CONCURRENT` | 8 | 1–64 per process |
| `AI_CONVERSATION_STREAM_TIMEOUT` | PT90S | PT5S–PT4M |
| `AI_CONVERSATION_STREAM_HEARTBEAT` | PT10S | at least PT0.1S, at most half the timeout |

Existing model/context/retrieval feature settings apply. No model parameters are accepted from the UI.
No schema auto-DDL, Python package, Java library, frontend package or infrastructure dependency is added.

`backend/./mvnw verify` builds and enforces independent >=80% line gates for conversations and SSE,
in addition to existing AI/retrieval gates. Authenticated E2E uses PostgreSQL/pgvector, actual PDF
extraction and deterministic embedding/LLM providers. It exercises saved provenance, selected-source
ownership, two-workspace isolation, access revocation, pagination, idempotent replay, expired leases,
transient errors, capacity, timeout and disconnect. React/shared-transport tests verify streaming
frames, retry identity, cancellation, history, source scope and citation page links. Run
`npm run test:coverage`, `npm run build`, `npm run lint`, `npm run format:check` in frontend; its AI
module retains >=80% lines/branches/functions/statements. No paid provider is used by these tests.
