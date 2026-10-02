# Source reader and research conversations (RH-297–299)

The source reader uses the existing `ToolShell` and source endpoints. Its metadata includes only fields from `WorkspaceSource`. Extraction, PDF navigation, dataset previews, immutable version downloads and replacement keep their existing contracts. On narrow screens the reader moves into the library's slide-over; a stable portal preserves preview selections and drafts across width changes. Upload, replacement and reprocessing controls follow workspace capabilities; the server remains responsible for authorization.

PDF citations retain `/app/workspaces/:workspaceId/sources/:sourceId?processingVersion=…&unit=…&page=…`. Navigating pages changes `page` and clears `unit`, preserving other selectors. Dataset previews retain the `version` selector. PDF files open in the browser's existing viewer.

`/app/workspaces/:workspaceId/ask` mounts the same `ResearchPanel` conversation controller as the document editor. Its page variant adds investigations grouped into Today, Yesterday and Earlier, a scope panel and citation inspection. The existing source comparison is available through the Compare sources dialog. The overview hands a question to this page through router state; that question is consumed once, including React StrictMode effect replay.

`?askSource=:sourceId` starts a new question scoped to that source. This source sends exactly one `selectedSourceIds` value; Selected sends an explicit array (including `[]`); All omits the selector. Switching scope reruns the last question with a new request ID. Checkbox changes are drafts until Apply scope or the next question. Stored user messages retain the scope used for each answer, and reopening history restores that scope. Retrying a stopped or failed stream retains its existing request ID. Streaming deltas remain previews until the complete answer is saved.

Citation quotes use the existing authorized endpoint:

```
GET /api/workspaces/:workspaceId/sources/:sourceId/retrieval/chunks/:chunkId?processingVersion=…
```

The client verifies workspace, source, immutable source version, processing version, chunk ID and content hash before displaying `content`. The quote is the cited retrieval fragment, rendered as plain text. It is never synthesized from an answer or replaced with the latest extraction. Original-unit span offsets are not used to slice the concatenated retrieval chunk. A failed read hides cached quote content and reports the existing API error.

No runtime dependencies, backend domain changes or migrations are introduced. Per-module Jest coverage gates require at least 80% of lines, statements, functions and branches for the new page, conversation presentation, quote transport and source frame/history/replacement components.

Verification:

- `cd frontend && npm run typecheck && npm run lint && npm run format:check`
- `cd frontend && npm run test:coverage -- --runInBand && npm run build`
- `cd backend && ./mvnw -Dtest=SourceApiIntegrationTest,ConversationServiceTest,ConversationContractTest,WorkspaceQuestionServiceTest,RetrievalChunkSetTest test`
- Browser flow against the local backend: upload PDF/TXT/CSV; follow a PDF page link; resize the reader; ask a single source; inspect a cited quote; change scopes and submit an empty selection; ask all sources after insufficient evidence; stop/retry; reload history; submit from the overview; replace a dataset and preview/download its older version; verify viewer controls and the server's rejection of unauthorized writes.
