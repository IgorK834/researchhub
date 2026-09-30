# Source extraction and preview (RH-090, RH-091, RH-093, RH-094, RH-095)

Implemented on the existing upload → PostgreSQL SOURCE_INGEST job → internal HTTP Python worker → source result
flow. The worker boundary (the prerequisite processing work) already existed; it previously acknowledged empty
results. Extraction is now performed before a source becomes READY. No index, retrieval engine, macro execution,
formula engine, or new infrastructure service is introduced.

## Output and provenance

The active internal contract is **v4** (`contracts/processing/v4/`, `schemaVersion=4.0`,
`processingVersion=source-ingest-4`). Backend and worker deploy together. Historical v1/v2/v3 fixtures remain
unchanged. V4 adds a separate retrieval chunk set; extraction units and the UI preview retain their existing model.
V12 upgrades stored v2 extraction payloads with empty row previews; reprocessing adds previews and retrieval chunks.
Both runtimes consume shared extraction and retrieval fixtures. See [source-retrieval.md](source-retrieval.md).

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
Old sources acknowledged by the former placeholder have no extraction; use the reprocess action to parse them.

## Persisted results and processing versions (RH-094)

Spring owns all database writes. `source_extractions` stores one current typed JSONB payload per source with
parser version, processing version, schema version, original content SHA-256 and normalized payload SHA-256. Equal
payload hashes retain the existing JSONB value. Pages and sections contain only ranges/locations; there is no
second full text blob. Small bounded row previews are separate from column samples so row order is preserved.

Flyway V12 creates `source_extraction_runs`, a journal of successful result persistence keyed by job ID. It records
versions, digest and timestamp, without copying extraction text. Retrying one job is idempotent. Reprocessing the
same immutable source creates a fresh job/generation and refreshes its current output. Earlier run metadata remains;
earlier full extraction text is not retained. Version/hash metadata allows future indexes to detect stale outputs.

The current-attempt lock rejects prior attempts/generations. Output and journal persistence share a transaction;
if either fails, both roll back. Source READY publication separately requires persisted output for that exact job
and commits with SUCCEEDED. On storage failure the existing bounded retry policy applies, eventually yielding
FAILED with a safe error. Worker parse failures yield FAILED immediately. An older run notification cannot change
the current source. No Python database credentials or driver are introduced.

`POST /api/workspaces/{workspaceId}/sources/{sourceId}/reprocess` returns `202` with PROCESSING. It requires an
owner/editor, active workspace and READY/FAILED source; concurrent/busy requests receive `409`. Input bytes/hash
never change. `GET .../extraction/runs` returns at most 100 successful persistence records, newest generation first,
including job status and versions. Content-reader authorization applies to this history even while processing.

## Source preview and citation locations (RH-095)

The detail page keys its extraction cache by the source update timestamp so a new run never opens cached text
from an earlier revision. It polls source metadata every two seconds during processing, displays failure and extraction
warnings, and offers reprocessing to editors/owners. DOCX/TXT show ordered extracted blocks. CSV/XLSX show sheet
visibility, schema samples and the first `AI_WORKER_PREVIEW_ROWS` bounded rows, including original row numbers.
Text/cell values are rendered as text; formulas and HTML are never executed.

`GET .../preview` streams PDFs inline through the authenticated backend with no-store, nosniff, sandbox CSP and
encoded filenames. Other types receive `415`. It is available before extraction completes, including scanned PDFs.
The regular `.../content` endpoint remains an attachment. The PDF opens in a separate browser tab with
`#page=N`; page support depends on the browser's PDF viewer. UI page controls use the persisted page count when
available and reject invalid pages. No Blob URL is exposed.

`GET .../locations/{unitId}` and `GET .../locations?pageNumber=N` return authorized current provenance: unit/page,
character range, typed location, parser/processing version, original SHA-256, product `sourceUrl` and PDF `previewUrl`
(or null for non-PDF). Missing/unauthorized/unpublished locations return the same `404`. The product URL accepts
`unit`, `page`, `sheet`, and `parserVersion` query parameters; matching units open and scroll into view. Each unit
has a location link. A link with a changed parser or missing unit displays a warning after reprocessing. It does not
pretend to reproduce old extracted text. These location APIs prepare future citations without adding indexing.

## Parsers

| Type | Implementation | Output and limitations |
| --- | --- | --- |
| PDF | pypdf 6.14.2 | One text unit per page, including empty pages, in original page order. Content-stream text order is deterministic; complex columns may need the cloud layout parser. No bounding boxes are invented. |
| DOCX | python-docx 1.2.0 | Paragraphs, headings and tables traversed together in body order; heading hierarchy and logical block index retained. Tables are linearized with tabs between cells and newlines between rows, including nested tables. No Microsoft Office required. Headers, footers, drawings and tracked revisions are outside this body-text parser. |
| CSV | Python CSV reader | UTF-8 (optional BOM), inferred comma/semicolon/tab/pipe delimiters, quoted separators and multiline fields. Ordered first rows and column samples; values remain text, including formula-looking cells. CSV has logical row locations, no PDF pages. |
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
handling. TXT retains bounded UTF-8 text extraction. CSV uses the same row, column and preview limits as XLSX;
row counts are exact only when the complete file fits the scan limit. Preview cells are capped at 500 characters.

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
| AI_WORKER_PREVIEW_ROWS | 50 / 100 |

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
The E2E flow covers upload, real blob-URL download, HTTP contracts, PDF/DOCX/CSV/XLSX results, durable failed jobs,
OCR_REQUIRED, publication, hashes, obsolete attempts/runs, viewer access and workspace isolation. It additionally
forces a journal database failure to verify rollback/no READY, retries it through reprocessing, checks fresh job
identities, single-payload storage, provenance history, safe PDF headers and citation page APIs. Separate Azurite
integration tests exercise the real storage adapter and read-only SAS capability.

From `frontend` run `npm run build`, `npm run lint`, and `npm run test:coverage -- --runInBand`. The full source feature and the extraction
components/APIs have coverage gates and tests for loading, warnings, sheets, samples, empty results, failed requests,
retry and safe rendering of source text. The worker image builds with `docker compose build ai-worker`.
