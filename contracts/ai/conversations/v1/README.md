# Research conversation v1 fixtures

`conversation.json`, `history.json`, `started.json` and `completed.json` define product-visible
conversation metadata, ordered complete messages, a pending submission event, and a final SSE/synchronous
turn. Java and React tests consume the same fixtures. Assistant `response` retains the existing workspace
question v1 envelope, context/citation mapping and provider/model/template/usage provenance. No hidden
reasoning, raw provider body, credential or prompt context is included.

Workspace identity is authoritative in `/api/workspaces/{workspaceId}/ai/conversations`. A message send
body includes a UUID `clientRequestId`, `question` and optional `selectedSourceIds` (omitted/null = all,
[] = none). Replays use the same identity and body; completed replays return the same assistant.

Additional SSE frames: `retrieval_completed` with `{chunkCount}`, `delta` with `{text}`, and terminal
`error` with `{code, detail, retryable}`. See the full
[API/lifecycle contract](../../../../docs/development/research-conversations.md).
