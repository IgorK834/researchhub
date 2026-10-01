# Retrieval substrate (RH-100–RH-105)

Implemented in the existing source ingestion pipeline: authenticated Python worker extracts the document, performs
structure-aware chunking, then returns both outputs in processing contract **v4** (`source-ingest-4`). Spring validates
source identity, workspace, original hash, every content span, hashes and versions before atomic persistence. This
is the retrieval substrate. Spring then obtains batched embeddings from the worker and atomically stores the
pgvector search projection. Azure AI Search provisioning remains deferred. RH-112 composes this retrieval
with the shared model gateway for [workspace questions](workspace-questions.md).

## Canonical chunk and search contracts

`contracts/retrieval/v1/` contains shared fixtures and JSON schemas. Public JSON uses camelCase in Java, Python and
the search projection; SQL uses snake_case. `RetrievalChunk`, Python's corresponding model, and
`RetrievalSearchDocument` expose the same fields:

| Field | Meaning |
| --- | --- |
| chunkId | Stable 64-character SHA-256 identity of workspace/source/processing version/index/content hash/spans. It is content-addressed and deliberately independent of `sourceVersionId` (the digest keeps an always-null slot for it), so ids minted before versioning stay valid. |
| sourceId, workspaceId | Mandatory UUIDs; every read is workspace-authorized. |
| sourceVersionId | The immutable source version the chunk was derived from (RH-130). The worker emits null; Spring binds the set to the job's version after validating it, and the column is `NOT NULL`. Search returns only chunks of a source's active version. |
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

`search-document.schema.json` adds field roles to the same chunk schema. Every adapter must filter by workspace,
source and processing version, and atomically switch the active indexed version. Source version identity is now an additional filter: search matches only chunks whose
`source_version_id` is the source's active version, and `source_version_retrieval_sets` keeps a snapshot of every version's
chunk set so analyses can be reproduced after a replacement ([source-versions.md](source-versions.md)). The Java/Python projection retains content and all provenance;
workspace/version scope is mandatory. RH-102–RH-105 add pgvector through Flyway V14; [ADR-002](../adr/ADR-002-retrieval.md) selects one adapter.

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

[RH-092 CSV data assets](csv-data-assets.md) produce schema metadata as the CSV extraction unit. New CSV
retrieval includes column names, inferred types, missing counts and scan limits; sampled data-row values remain
only in structured previews. Reprocess older CSV sources to replace their historical row-text index with this
schema-only projection. Parser revision changes automatically version chunk identities.

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


## Embeddings and model boundaries (RH-102)

Java `EmbeddingProvider` and Python `EmbeddingProvider` expose `embedDocuments`, `embedQuery`
(Python snake_case), and `modelMetadata`. Java calls the authenticated worker endpoints:

- `GET /internal/embeddings/model` returns `{provider, name, version, dimension}`.
- `POST /internal/embeddings/documents` with `{texts: [...]}` returns `{metadata, vectors}`.
- `POST /internal/embeddings/query` with exactly one text uses the same vector space.

Inputs are nonempty text, <=8000 Unicode code points each; each HTTP request contains
1–32 texts and <=1 MiB JSON. Responses are bounded at 4 MiB. Python and Java validate
vector count, dimension, finite components and nonzero norm. Document calls batch at 32.
`AI_WORKER_EMBEDDING_PROVIDER=deterministic` selects the stable token-hashing fake
(32 dimensions, `token-hash` v1). It is offline scaffolding, not evidence of production
semantic quality. Select `azure` with all six `AZURE_EMBEDDING_*` settings in `.env.example`
to use a real model. Model name is the provider's returned base name, deployment is the
Azure deployment name, and version is the immutable deployed model revision. Automatic
deployment upgrades must be disabled; version changes require explicit rebuilding.

Azure uses pinned REST API `v1`, HTTPS, no redirects, timeout 8 seconds per attempt.
The wrapper retries connection/timeouts and HTTP 408/429/500/502/503/504 at most three
times, with backoff 0.2s/0.4s capped at 1s. Authentication, invalid input or malformed
provider results are permanent failures. Provider error bodies, keys, signed file URLs
and source text are not returned as failure details. Durable job retry remains separately
bounded by the existing processing policy. Cost/usage telemetry is intentionally deferred.
No new Python dependency or Java vendor SDK is needed.

## Hybrid retrieval and publication (RH-104/RH-105)

Flyway V14 enables `vector` in schema `public`, records model namespaces, and creates
`source_chunk_embeddings`. This disposable projection contains grounded chunk text,
`simple` PostgreSQL full text, vectors and the existing version/provenance identity.
Composite keys enforce the chunk's workspace/source/version; vectors must match the
model dimension. Chunk replacement/deletion cascades only to its search projection,
never to domain sources/workspaces. Each namespace includes provider/name/version/dimension.
Exact cosine comparisons only run inside that namespace.

`RetrievalIndex.upsert` replaces the whole current source projection transactionally.
`delete(workspaceId,sourceId)` is scoped and idempotent; `upsert` rebuilds it. A failed
insertion rolls back extraction, journal, chunks and vectors. `existsForJob` validates
complete publication for the exact job. READY now requires extraction, chunk set and
index. Existing READY sources without embeddings stay readable but require explicit
reprocessing before search; no data is invented by V14.

`GET /api/workspaces/{workspaceId}/retrieval/search?query=...&sourceIds=...&topK=10`
returns ordered `RetrievalHit` records (`chunk`, fusion `score`, `vectorSimilarity`,
`lexicalScore`, `model`). Omit `sourceIds` for all READY sources, or pass comma-separated
UUIDs for selected sources. Service calls with an empty list search no sources. `topK`
is 1–50, query <=2000 characters, source selection <=100 UUIDs. Authorization precedes
embedding and selected-source checks; unowned/missing selected sources receive 404.
Results retain all original page ranges, extraction spans, hashes and processing version.

A materialized SQL scope filters workspace, selected sources, model namespace and READY
state before cosine/full-text ranking. It joins the current extraction job and chunk set.
There is no global-result post-filter. Ranked lexical and vector candidate lists (up to
10*topK each) merge with reciprocal rank fusion (constant 60); ties use stable chunk IDs.
An unrelated query may return nearest neighbors: generation/evidence sufficiency is a
future use case and must not assume that every returned hit supports a claim.

The source progress endpoint `GET .../sources/{sourceId}/processing` reports the latest
job's status, stage, coarse percent and attempt. The source detail page polls while busy.
Stages are EXTRACT (worker parsing/chunk construction, 10%), CHUNK (backend contract
validation, 30%), EMBED (50%), INDEX (75%) and FINALIZE (90%, then 100% at SUCCEEDED).
PENDING retries report 0% and retain the last failed stage for diagnosis. Progress commits
separately from result transactions so a rolled-back INDEX failure remains visible.

Provider calls run outside DB transactions and locks. Input identity/current attempt is
checked before embedding and again inside the write transaction. Reprocessing hides old
search rows through authoritative source status until the new complete result is READY.
Shared contracts: `contracts/embeddings/v1/`. Build and test with the commands above;
backend tests require Docker and the frozen worker environment. The cloud Spring profile
remains the existing environment-validation scaffold; source/retrieval product routes
run under `local`. Azure embedding selection works with that profile without domain changes.
