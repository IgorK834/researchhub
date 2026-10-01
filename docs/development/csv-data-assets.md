# CSV data assets (RH-092)

CSV ingestion now produces a bounded data profile rather than treating the sampled records as prose.
The existing upload → SOURCE_INGEST → Python parser → Spring persistence/index → source preview flow
is retained. Spring owns workspace authorization, original-file identity and persistence. Python owns
parsing/inference. No new package, runtime, table, service or source-upload endpoint is introduced.

## Parsing and schema

`csv-stdlib/rh-2` uses Python's strict CSV reader. UTF-8 with an optional UTF-8 BOM is supported.
Comma, semicolon, tab and pipe separators are detected; quoted separators, escaped quotes and
multiline cells remain structured strings. A one-column file can have `delimiter=null`. Delimiter
sniffing is advisory: a bounded fallback checks candidate record widths and rejects ambiguity or
inconsistent column counts. Invalid encoding and NUL/binary data fail rather than silently replacing
characters. Other encodings, including legacy Windows code pages, must be converted to UTF-8.

The first nonempty logical record is the **assumed header**, not a reliable determination that a file
has headers. Raw header candidates remain in the sheet preview. Profile names normalize whitespace,
fill blank names with `column_N`, and deterministically disambiguate duplicates with numeric suffixes.
Original values, including leading-zero identifiers and formula-looking cells, stay strings; no
formula, macro or cell code is evaluated.

Primitive types are inferred from nonmissing cells in the bounded data scan: `integer`, `number`,
`boolean` (true/false), ISO `date`, `text`, or `unknown` for entirely missing/unsampled columns. Integer
and decimal/exponent types can combine into number. Mixed incompatible types become text. Leading-zero
identifiers, locale-specific decimals, NA/null literals and invalid dates remain text. Long values are
conservatively text. Inference is heuristic and can be wrong; both stored warnings and the UI say so.

A missing cell is empty or whitespace-only. No implicit NA/null/sentinel policy is applied. Missing
counts are per column over `profiledRowCount`; blank logical data records count as missing in each
profiled column. Blank records before the header are excluded from data counts. Preview record numbers
are logical CSV records (a multiline field does not become several rows).

## Public profile and limits

The v4 extraction contract gains optional/null `workbook.csvProfile` with its own `schemaVersion=1.0`.
The existing sheet metadata, ordered row previews and column samples remain compatible. Canonical
[profile/schema fixtures](../../contracts/tabular/v1/README.md) and an actual CSV result in
[`contracts/processing/v4/source-ingest-result-csv.json`](../../contracts/processing/v4/source-ingest-result-csv.json)
are consumed by Java, Python and React tests.

```json
{
  "schemaVersion": "1.0",
  "encoding": "UTF-8",
  "delimiter": ";",
  "headerPolicy": "FIRST_NONEMPTY_RECORD",
  "missingValuePolicy": "EMPTY_OR_WHITESPACE",
  "indexPolicy": "SCHEMA_ONLY",
  "rowCount": 2,
  "profiledRowCount": 2,
  "rowScanComplete": true,
  "columns": [{"columnNumber": 1, "name": "age", "inferredType": "integer", "missingCount": 1}]
}
```

This is an abbreviated profile. `rowCount` is the exact **data** row count only when the bounded scan
reaches EOF; otherwise null. `profiledRowCount` excludes the header and blank prefix. The existing
sheet's `rowCountEstimate` counts logical records including the header/prefix; it is not a data-row
count. `rowScanComplete` refers to rows only; `sheet.truncated` also flags excluded columns. A complete
row scan can therefore coexist with a limited column profile.

Reuse existing configured limits: `AI_WORKER_XLSX_ROWS` (default 1000, max 10000),
`AI_WORKER_XLSX_COLUMNS` (64, max 256), `AI_WORKER_XLSX_SAMPLES` (10, max 100) and
`AI_WORKER_PREVIEW_ROWS` (50, max 100). The header/prefix consumes the record scan limit. Read one extra
record to detect truncation without scanning an arbitrarily large file. Row previews and per-column
samples remain bounded, with cell text and names limited to 500 UTF-16 units without splitting Unicode
characters, matching the existing Java sheet metadata boundary. No unbounded row count is claimed.
Types use the whole bounded scan, not just the first few displayed samples. The existing upload/download
byte, CSV field-size, extraction text and 4 MiB result limits still apply.

## Retrieval, provenance and safety

Only a deterministic schema summary is included in extracted text/retrieval: encoding, separator,
count/completeness information, column names, inferred types and missing counts. **No sampled data-row
values are put into the RAG text index**, for small or large CSV files. Row samples stay in authorized
structured preview metadata. AI source questions can discover a dataset's schema; calculations and
row-level conclusions require the original data and the separate future analysis workload.

The summary is explicitly derived metadata with a CSV sheet location, not a fabricated PDF page or
raw row quotation. It retains source/workspace IDs, original file SHA-256, parser revision, processing
version, retrieval identity and code-point spans. Source headers/metadata remain untrusted data:
context packing escapes them and React renders text, including formula-looking or HTML-looking cells.
Python and Spring validate profile counts, policies, ordered unique columns and consistency with the
sheet scan before READY/index publication. Existing retry/version replacement is idempotent.

Safe terminal failures are `CSV_ENCODING_INVALID`, `CSV_DELIMITER_INVALID`, `CSV_MALFORMED`,
`EMPTY_DOCUMENT` and existing extraction-limit errors. Messages describe the problem without echoing
source values, parser exceptions, signed URLs or credentials. They use existing durable job/source
failure states; a failed parse publishes neither metadata nor searchable chunks. Selected delimiter
and profile completeness are always explicit; data beyond the bounded scan is not declared valid.

Reads use the existing authorized `GET /api/workspaces/{workspace}/sources/{source}/extraction` with
private/no-store responses. Foreign-workspace IDs and revoked/nonmembers get the same 404 as missing
sources. The frontend displays the profile beside the existing row preview with inference/missing
policy caveats and unknown totals when the scan is incomplete.

## Compatibility, rollout and verification

Backend and worker deploy together. This is an additive nullable JSON attribute inside existing
Flyway-created JSONB storage, so there is no PostgreSQL DDL or Hibernate schema creation. Historical
v1–v4 fixtures are unchanged. Old workbook payloads without a profile deserialize with `csvProfile=null`;
XLSX behavior remains unchanged. New CSV output uses `csv-stdlib/rh-2`, automatically changing retrieval
version/identity through the existing parser-version hash. Existing sources retain their historical
extraction/index until an authorized owner/editor reprocesses them. Reprocessing creates the new
profile/schema index and replaces old active chunks; it does not overwrite provenance journal records.
No inference or missing counts are invented for an old payload.

`ai-worker`: `sh scripts/check.sh` runs the complete pinned-worker tests and a dedicated >=80% coverage
gate for CSV/profile contracts. `backend`: `./mvnw verify` builds and enforces >=80% coverage for CSV
profile validation plus existing source/processing gates. Authenticated PostgreSQL/real-worker E2E
covers comma/semicolon/BOM, primitive types/missing counts, a large file's bounded profile, absence of
row markers in the embedding index, legacy reads/reprocessing without duplicate chunks, safe failures,
two-workspace isolation and membership revocation. `frontend`: `npm run test:coverage`, `npm run build`,
`npm run lint`, `npm run format:check`; the profile and source module have >=80% gates, shared fixtures,
preview integration and safe-rendering tests. `docker compose build ai-worker` verifies the deployable
pinned Python image. These checks need no paid provider.

## Dataset preview (RH-131/132)

The profile described here is what the bounded, versioned [dataset preview](dataset-inspection.md) is built from: its
CSV columns, inferred types, missing counts and exact-or-unknown row count are served per immutable source version
without reading the file again.
