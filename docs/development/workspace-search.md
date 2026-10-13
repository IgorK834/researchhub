# Workspace lexical search

Task 35.4 extends the workspace command dialog to documents, sources, conversations, comments and analyses.
PostgreSQL 17 full-text search is the only search engine; no Elasticsearch, Azure Search, semantic embedding or
Gemini request is introduced. Imported bibliography-only entries are metadata, not source extraction or evidence.

## Contract and isolation

`GET /api/workspaces/{workspaceId}/search?q=phrase&types=DOCUMENT,SOURCE&limit=25&cursor=...` returns:

```json
{
  "items": [{
    "type": "DOCUMENT", "id": "uuid", "title": "Current title", "snippet": "Plain text only",
    "location": "/app/workspaces/uuid/documents/uuid", "sourceVersion": "12",
    "updatedAt": "2026-10-13T10:00:00Z"
  }],
  "nextCursor": null
}
```

`q` must contain 1–200 characters without control characters, `limit` is 1–50 (default 20), and types are one or more
of `DOCUMENT`, `SOURCE`, `CONVERSATION`, `COMMENT`, `ANALYSIS`. Invalid inputs/cursors return 400. Every request
checks current workspace membership on the server; SQL additionally constrains workspace ID and active membership
before selecting any snippet. Foreign workspace or revoked membership returns the standard opaque 404, without
counts or snippets. Cursors are bounded and bound to caller/workspace/query/type scope; they do not convey access.

Pagination uses `updatedAt DESC, type ASC, id DESC` with a timestamp/type/UUID keyset (no offset, no result count).
For an unchanged corpus it never repeats objects. Like other current-state searches, edits between pages can move
an object in the ordering; this is not a frozen result snapshot. Start a new search to see newly updated results.
Archived documents and their comments are always excluded. Other types currently have no object-level archive
state; workspace reader authorization follows the existing archived-workspace policy. Erased workspaces are excluded.

## Projection and versions

Flyway V50 adds `workspace_search_entries`, generated `tsvector` using the explicit `simple` configuration, a GIN
index and a scoped keyset-order index. Database triggers follow the existing transaction/publication boundary: an
object and its projection commit together, and old objects are backfilled by the migration. No per-result ORM
lookup or model call is needed. Text is extracted from supported natural-language JSON fields; code, rows,
diagnostics, model usage and provenance are excluded.

| Type | Indexed current content | Version / destination |
|---|---|---|
| Document | Title and current editor JSON | Document revision / document page |
| Source | Bibliography and active-version extraction | Active source UUID / source page with `version` |
| Conversation | Title and completed messages/answers | Latest allocated sequence / `ask?conversation=...` |
| Comment | Body, anchor quote, replies and document title | Current document revision / document `#comment-...` |
| Analysis | Prompt, plan and dataset/problem result metadata | Latest execution UUID when available / analysis page |

Document changes update comments' titles, revision and archive visibility. Active source changes replace indexed
extraction, never expose an obsolete extraction as current. Publication of completed answers, comment replies and
execution metadata refreshes the same object, rather than producing duplicate hits. Frozen RAG citations, source
versions and execution records remain untouched. V50 integrates projection cleanup with the existing restricted
account-erasure function; runtime users cannot bypass immutable provenance.

## UI

Cmd/Ctrl K opens search in an authorized workspace; another modal retains its keyboard ownership. Typing is
debounced by 250 ms and requests are cancellable. Type filters and next-page cursors reset on a changed query.
Arrow keys choose results, Enter follows the deep link, Cmd/Ctrl Enter opens a text preview beside the current
page, and Escape restores focus. The preview is explicitly not citation evidence. Snippets/highlights render
React text, never untrusted HTML. Conversation/comment navigation handles same-page deep links.

## Performance and reproducibility

`WorkspaceSearchApiIntegrationTest.lexicalSearchP95IsBelow500msForTenThousandSyntheticObjects` creates
10,000 synthetic objects across all five types, runs `ANALYZE`, warms up three HTTP requests, measures 20 complete
authenticated HTTP searches (50 results each) and requires nearest-rank p95 <=500 ms. It writes timings, PostgreSQL
version, runtime/environment and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` to
`backend/target/task35-search-benchmark.json`. The plan excludes headline rendering; HTTP timings include snippets,
authorization, JDBC and JSON. This is a local warm-cache lexical benchmark, not a production-load SLA.

Measured 2026-10-13: p95 **7 ms** on macOS/aarch64, 12 available processors, Java 25.0.2 and Testcontainers
`pgvector/pgvector:0.8.2-pg17-bookworm` (PostgreSQL 17.10). The common-term query selected the workspace/order index
and stopped at 51 rows; membership ran once as an InitPlan, without N+1. The planner can use the GIN index for
selective terms. No Gemini calls were made. Repeat the test to obtain current machine-specific results.

Run `./mvnw verify` in `backend` (Docker required), then frontend coverage/lint/build as documented for
[bibliography migration](bibliography-import.md). Unit tests cover query/cursor limits and scope binding; real
PostgreSQL/API tests cover all five types, transactional updates, archived state, pagination, foreign workspaces
and revoked membership. Separate JaCoCo/Jest line and branch gates require >=80% for this executable module.
