# Retrieval chunks (RH-100, RH-101)

Implemented in the existing source ingestion pipeline: authenticated Python worker extracts the document, performs
structure-aware chunking, then returns both outputs in processing contract **v4** (`source-ingest-4`). Spring validates
source identity, workspace, original hash, every content span, hashes and versions before atomic persistence. This
is the retrieval substrate. Embeddings, Azure index provisioning and query ranking remain later backlog work.

## Canonical chunk and search contracts

`contracts/retrieval/v1/` contains shared fixtures and JSON schemas. Public JSON uses camelCase in Java, Python and
the search projection; SQL uses snake_case. `RetrievalChunk`, Python's corresponding model, and
`RetrievalSearchDocument` expose the same fields:

| Field | Meaning |
| --- | --- |
| chunkId | Stable 64-character SHA-256 identity of workspace/source/version/index/content hash/spans. |
| sourceId, workspaceId | Mandatory UUIDs; every read is workspace-authorized. |
| sourceVersionId | Explicit null until immutable source versioning is introduced. Current SQL rejects non-null values. |
| chunkIndex | Ordered, contiguous index starting at zero within the current set. |
| content | Source text, with two newlines between extracted units. Never generated or executed. |
| pageStart, pageEnd | Inclusive PDF page range; null for sources without physical pages. V1 never crosses a page boundary. |
| sectionTitle | Heading context for the referenced section, retained on subsequent windows. |
| contentHash | SHA-256 of UTF-8 content. |
| processingVersion | Retrieval version fingerprint, including ingestion/parser version, file/extracted-text hashes and chunking configuration. |
| spans | Extraction unit ID and half-open original characterStart/characterEnd ranges. |

All character counts and ranges use Unicode code points. The backend verifies reconstructed content against each
source span, including Unicode outside the BMP. Original extraction offsets have no implicit separators; the two
newlines used when composing retrieval content are synthetic and have no source span. They never shift original
citation locations. Gaps containing non-whitespace source text are rejected, as are forged hashes, identities,
page/section references and incompatible versions.

Chunk IDs exclude job IDs and delivery timestamps: rerunning the same immutable input and configuration preserves
IDs. A changed parser, extracted text, input hash or configuration changes the retrieval version and IDs. The
version fingerprint is SHA-256 of a compact UTF-8 JSON array described by `RetrievalIdentity` / `identity_digest`.
Shared fixtures test equality across runtimes. Bump `hierarchical-char-1` when changing the chunking algorithm.

`search-document.schema.json` adds field roles to the same chunk schema. A future adapter must filter by workspace,
source and processing version, and atomically switch the active indexed version. Source version identity can become
an additional filter once that feature exists. The Java/Python projection retains content and all provenance;
workspace/version scope is mandatory. No external search dependency is introduced by these tasks.

## Deterministic hierarchy

1. Preserve page, section and sheet boundaries. Empty extraction units create no retrieval text.
2. Merge consecutive paragraphs/tables within one section. A parent heading immediately followed by a child heading
   and its body is carried into that child scope, avoiding an otherwise isolated heading.
3. For oversized scopes, prefer paragraph boundaries, then line boundaries, then word boundaries. Fall back to a
   character window when the source has no suitable separator.
4. Apply the configured overlap. Rebalance a tiny final window where possible. Retain a short section or page when
   crossing its provenance boundary would be unsafe. A heading stays with body text whenever the size cap permits;
   an oversized heading or final standalone heading retains its own grounded spans.

This is a character strategy, not a model-specific tokenizer. Whitespace around window boundaries is removed by
adjusting spans. Tables and sheets retain their original unit locations through span IDs. No spreadsheet formula,
macro, generated code or source markup executes.

| Environment variable | Default | Bounds |
| --- | --- | --- |
| AI_WORKER_CHUNK_MAX_CHARACTERS | 1600 | 32–8000 |
| AI_WORKER_CHUNK_OVERLAP_CHARACTERS | 150 | 0–floor(max/2) |
| AI_WORKER_CHUNK_MIN_CHARACTERS | 200 | 1–(max-overlap) |

Settings are loaded and validated when the worker starts. The complete config and algorithm version are returned
in every chunk set, persisted in its manifest and recorded in the successful extraction journal. The existing
4 MiB worker response limit applies to combined extraction and retrieval output; at most 10,000 retrieval chunks
are permitted. Parser/file limits remain in [source-extraction.md](source-extraction.md).

## Storage and publication

Flyway **V13** creates `source_retrieval_sets` and `source_retrieval_chunks`. There is one current manifest per source;
chunk rows contain location spans and metadata. Content is reconstructed from the single current extraction, avoiding
a second full text blob and storing overlap as references. The product/search projection still includes content.

Extraction, successful-run journal, manifest and chunk rows commit in one transaction. A chunk insertion or journal
failure rolls back the whole result. READY additionally requires the exact job's extraction and complete chunk set.
A reprocessing transaction replaces every current row together; composite foreign keys enforce workspace/version
consistency. Readers use a repeatable-read snapshot and join on extraction job identity, preventing mixtures of
results from different jobs. Previous successful-run metadata keeps parser, ingestion/retrieval versions and config;
previous full text/chunk sets are not retained. Old v2/v3 extraction data remains usable in the preview; reprocess to
produce retrieval chunks. No chunks are fabricated during migration.

## Authorized read API

- `GET /api/workspaces/{workspaceId}/sources/{sourceId}/retrieval` returns the current chunk set when READY,
  otherwise `204` (also for legacy READY sources without chunks).
- `GET .../retrieval/chunks/{chunkId}` returns one grounded current chunk; absent/unpublished/unauthorized reads
  receive the source module's uniform `404`.
- Both endpoints accept an optional `processingVersion` precondition. An authorized read of a different current
  version receives `409` so downstream consumers cannot silently use stale chunks. Authorization runs first.

Readers/viewers can inspect chunks, including in archived workspaces. Reprocessing keeps the existing editor/owner
and active-workspace checks. Responses use `Cache-Control: private, no-store`. A PDF citation can use the chunk's
pageStart/pageEnd plus source/workspace ID with the existing `.../preview#page=N` route and source location APIs.
Source spans retain exact extraction locations for later DOCX/table citations.

## Verification

```bash
cd ai-worker
uv sync --frozen
uv run --frozen pytest
uv run --frozen coverage report --include='*/retrieval/*' --fail-under=80
cd ../backend
./mvnw verify
```

The worker tests cover short/oversized sections, overlap, tail balancing, heading preservation, parent/child
headings, physical page boundaries, Unicode spans, deterministic IDs and version changes. Shared schemas/fixtures
are consumed in Python and Java and compared with search projections. The backend has a separate 80% JaCoCo gate
for `dev.researchhub.ai`. Real Python HTTP → PostgreSQL → product API E2E tests cover authorization, citations,
worker restart with a changed config, complete version replacement, compatible rerun ID stability, safe stale-version
refusals, and rollback when PostgreSQL suppresses a chunk insert. Spring owns every database write.

Deploy backend and worker together because v4 rejects older worker responses. Build the image with
`docker compose build ai-worker`; Compose passes the three chunking settings. Frontend extraction preview contracts
remain unchanged, and extraction units remain distinct from retrieval chunks.
