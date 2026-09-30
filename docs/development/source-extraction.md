# Source extraction (RH-090, RH-091, RH-093)

Implemented on the existing upload → PostgreSQL SOURCE_INGEST job → internal HTTP Python worker → source result
flow. The worker boundary (the prerequisite processing work) already existed; it previously acknowledged empty
results. Extraction is now performed before a source becomes READY. No index, retrieval engine, macro execution,
formula engine, or new infrastructure service is introduced.

## Output and provenance

The active internal contract is **v2** (`contracts/processing/v2/`, `schemaVersion=2.0`,
`processingVersion=source-ingest-2`). Deploy backend and worker together. Historical v1 fixtures remain unchanged;
v1 responses are rejected by the v2 backend. Both runtimes consume shared PDF and workbook contract fixtures.

Each chunk is an extracted unit with `sourceId`, `parserVersion`, `ordinal`, `text`, nullable `pageNumber`,
`sectionId`, half-open `characterStart`/`characterEnd`, and optional typed `location`. Offsets count Unicode code
points in the concatenation of chunk texts; there are no implicit separator characters between units. PDF page
numbers start at 1. DOCX has logical block/section locations rather than fabricated pagination; XLSX has sheet/range
locations. `parserVersion` includes the exact library version and the ResearchHub extraction algorithm revision.
Bump the latter whenever extraction behavior changes. The result retains the original file SHA-256.

Spring checks identity, offsets, order, references, sizes, and hash before writing. Flyway V11 creates
`source_extractions`; the JSONB payload holds explicit, typed extraction data, not an opaque worker response or a
signed URL. A row belongs to its source/workspace/job. A duplicate result replaces that source's current payload
idempotently. A current-attempt row lock prevents obsolete deliveries from overwriting newer work. Results are
visible only after READY. Durable job completion and source status publication share a database transaction; a
failed attempt cannot publish success. If the process stops between result storage and completion, a later
redelivery safely stores the same extraction again.

`GET /api/workspaces/{workspaceId}/sources/{sourceId}/extraction` returns the extraction or `204` when not yet
published. It uses server-side VIEW_CONTENT authorization, includes `Cache-Control: private, no-store`, and gives
the same 404 for a non-member, missing source, or source in another workspace. No storage credentials are returned.
The source detail page displays page/block text, OCR warnings, sheet visibility, headers, samples and their limits.
Old sources acknowledged by the former placeholder have no extraction; upload those files again to parse them.

## Parsers

| Type | Implementation | Output and limitations |
| --- | --- | --- |
| PDF | pypdf 6.14.2 | One text unit per page, including empty pages, in original page order. Content-stream text order is deterministic; complex columns may need the cloud layout parser. No bounding boxes are invented. |
| DOCX | python-docx 1.2.0 | Paragraphs, headings and tables traversed together in body order; heading hierarchy and logical block index retained. Tables are linearized with tabs between cells and newlines between rows, including nested tables. No Microsoft Office required. Headers, footers, drawings and tracked revisions are outside this body-text parser. |
| XLSX | openpyxl 3.1.5 | Read-only, `data_only=False`, `keep_vba=False`, `keep_links=False`. Ordered sheets including hidden/veryHidden, producer-reported used range/dimensions, first nonempty row as header candidate, samples/types, row estimate and formula detection. Formulas remain strings. |

Image-only PDF pages are detected by their image resources and absence of extracted text. A fully scanned PDF
returns safe `OCR_REQUIRED`; a mixed PDF succeeds with an OCR warning and empty units preserving affected page
numbers. Password-protected PDFs return `PDF_ENCRYPTED`. Malformed inputs return `DOCUMENT_PARSE_FAILED`, with no
partial result. These structured parsing failures terminate the durable job immediately. Transient download/HTTP
failures remain retryable, and expired access is refreshed by the backend. The worker does not cache download failures.

XLSX dimensions are estimates supplied by the producer, including formatted cells. Iteration resets those
reported dimensions to avoid omitting sampled data when a producer reports an incorrect used range. Row/column
limits apply regardless of reported dimensions. `formulaPresence=true` means a formula was found; `false` means a
complete bounded scan found none; `null` means no formula was found in an incomplete sample. `formulaScanComplete`
and `truncated` make this distinction explicit. Values are capped at 500 characters. Header candidates are
heuristics, not a schema inference. Missing dimensions remain unknown rather than requiring an unbounded scan.

`.xlsm` is rejected by upload validation. Office archives containing VBA or macro-enabled content declarations are
also rejected even if renamed `.xlsx`/`.docx`. Macros and formulas are never executed. OOXML archive entry and
uncompressed-size limits are checked before library parsing. The pinned defusedxml dependency hardens openpyxl XML
handling. TXT/CSV retain bounded UTF-8 text extraction; CSV schema profiling is outside these tasks.

## Limits and local networking

Worker settings are validated on startup and may lower these ceilings:

| Variable | Default / maximum |
| --- | --- |
| AI_WORKER_MAX_FILE_BYTES | 52,428,800 / 52,428,800 |
| AI_WORKER_MAX_CHARACTERS | 500,000 / 500,000 |
| AI_WORKER_MAX_UNITS | 10,000 / 10,000 |
| AI_WORKER_MAX_PAGES | 2,000 / 10,000 |
| AI_WORKER_MAX_ZIP_BYTES | 104,857,600 / 104,857,600 |
| AI_WORKER_MAX_SHEETS | 100 / 100 |
| AI_WORKER_XLSX_ROWS | 1,000 / 10,000 |
| AI_WORKER_XLSX_COLUMNS | 64 / 256 |
| AI_WORKER_XLSX_SAMPLES | 10 / 100 |

One text unit may contain at most 250,000 code points. The serialized result must fit the existing 4 MiB response
boundary. Exceeding limits returns `EXTRACTION_LIMIT_EXCEEDED` rather than silently reporting complete extraction.
Downloads use a 30-second socket timeout, enforce the byte limit, and refuse redirects. Service credentials are
never forwarded to blob storage. Process-local idempotency keeps at most 16 results; the database is authoritative
across process restarts/eviction.

When Spring runs on the host and the worker in Compose, `127.0.0.1` inside the worker is not the host's Azurite.
Compose sets `AI_WORKER_BLOB_URL_ORIGIN=http://127.0.0.1:<published-Azurite-port>` and
`AI_WORKER_BLOB_URL_TARGET_ORIGIN=http://azurite:10000`. The worker translates only that exact origin, retaining the
signed blob path/query. Neither setting is enabled for a native worker or cloud URL by default. If overriding the
backend's Azurite endpoint, set the origin to the matching scheme/host/port; both variables must be supplied together.

## Azure Document Intelligence evaluation

The cloud-quality candidate is Azure Document Intelligence's **prebuilt-layout**, GA API **2024-11-30**. It supports
PDF OCR plus page/paragraph/table structure and bounding regions, allowing citation geometry beyond the local
parser. This matches future scanned lecture and multi-column requirements. See Microsoft's
[layout model documentation](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0).

Decision for these tasks: ship the usable offline path and the explicitly permitted `OCR_REQUIRED` fallback. No
Azure resource is provisioned or charged, and there is no cloud OCR adapter enabled yet. Before enabling that path,
benchmark representative lecture PDFs/scans against local text order, Polish text and table accuracy; measure
latency and per-page cost; confirm the workspace data's region/retention requirements. The adapter belongs in the
Python worker, should use a separately versioned parser and managed credentials, bounded polling/timeouts, and map
cloud page/bounding locations into this contract. It must retain source identity/hash and report safe service errors
through existing jobs. Spring continues to own authorization, source metadata and persistence.

## Verification

From `ai-worker`, after installing the pinned uv 0.12.20:

```bash
uv sync --frozen
uv run --frozen pytest
uv run --frozen coverage report --include='*/parsing/*' --fail-under=80
```

With Docker available, from `backend` run `./mvnw verify`. This builds the backend, enforces existing 80% source and
processing JaCoCo gates, and runs `SourceExtractionEndToEndTest`, which starts the actual pinned Python worker and
PostgreSQL Testcontainers. Install the worker environment first; the E2E test fails explicitly if it is unavailable.
The E2E flow covers upload, real blob-URL download, HTTP contracts, PDF/DOCX/XLSX results, durable failed jobs,
OCR_REQUIRED, publication, hashes, obsolete attempts, viewer access and workspace isolation. Separate Azurite
integration tests exercise the real storage adapter and read-only SAS capability.

From `frontend` run `npm run build`, `npm run lint`, and `npm run test:coverage -- --runInBand`. The extraction
component/API have coverage gates and tests for loading, warnings, sheets, samples, empty results, failed requests,
retry and safe rendering of source text. The worker image builds with `docker compose build ai-worker`.
