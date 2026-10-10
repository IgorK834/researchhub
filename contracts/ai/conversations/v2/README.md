# Contextual conversations / history v2

Canvas input commands keep [canvas v1](../../canvas/v1/README.md). `turns.schema.json` documents
implemented commands and their additive durable status view. Old conversations omit `origin` and
`turns`; the `/messages` and SSE v1 APIs keep their existing behavior. Contextual conversations use
`/contextual` for atomic creation/reservation and `/{id}/turns` for continuation. Requests return 202.
GET the turn or shared conversation history to observe completion; closing the client never cancels it.
Cancellation uses POST `/{id}/turns/{turnId}/cancel` and is restricted to the turn author.

Idempotency hashes include version, instruction, context, intent, explicit source versions, saved
analysis references and reply/proposal IDs. Concurrent first sends use a caller/workspace-scoped
clientConversationId. Replays return the existing operation and do not consume inference quota.
Mismatched payloads return 409. A failed operation is preserved; a new deliberate attempt uses a new ID.
Pending leases are reclaimed after five minutes with a new fence; a late response cannot publish.

History contains safe complete message text, origin document/title/context, immutable model/citation
metadata and typed turn links. Operation state is separate from saved answer text. Pagination remains
25 message pairs / 50 conversations maximum and uses the existing history cursor/cache.

`model-request.schema.json` defines the envelope and memory types; runtime validators also enforce
UTF-16, history byte bounds, hash/citation membership and the complete token budget.
`model-request.json` is the shared v3 model context fixture. It wraps unchanged generation v1 and
S/A evidence with separately typed untrusted conversation memory. Limits: six recent messages,
4096 UTF-8 bytes of message entries, 4000 UTF-16 selected characters, 512 before/after, and 8000
instruction characters. The entire user JSON consumes the existing conservative context/token budget.
History omits any pair whose scope is not a subset of the new explicitly selected scope. References
outside memory/scope require clarification. Memory never supplies citations or expands tool access.
Only current explicit source versions and executions supply S/A labels. Authoring IDs resolve through
the existing suggestion API; accepted IDs use recorded block identities and current document text.

EDIT/ANALYZE/SOLVE require editor permission and currently save a clarification directing the user to
existing tools. Routing and proposal application belong to CAI-07–09; this release does not fabricate
proposal/execution IDs. Unavailable/ambiguous follow-ups save WAITING_FOR_INPUT + CLARIFICATION.
