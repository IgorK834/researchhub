# Dataset inspection (RH-131, RH-132)

A safe, bounded, inspectable description of an uploaded CSV/XLSX **version**, for the browser and for the future analysis
planner. The browser never downloads or parses the workbook; the Spring API never opens it either: it projects the
profile the Python worker already produced when the version was processed.

Related: [source-versions.md](source-versions.md) (the immutable version being described),
[computation-planning.md](computation-planning.md) (authorized requests and structured plans),
[csv-data-assets.md](csv-data-assets.md) (the CSV profile it is built from),
[source-extraction.md](source-extraction.md) (workbook metadata), and the shared contract
[`contracts/analysis/dataset-preview/v1`](../../contracts/analysis/dataset-preview/v1/README.md).

## API

```text
GET /api/workspaces/{workspaceId}/analysis/datasets/{sourceId}/versions/{versionId}/preview
```

Session-authenticated, `Cache-Control: no-store`. A member of any role may read it; everything else is the same `404` a
missing resource gets, including a version id that belongs to another source or workspace.

| Status | Meaning |
| --- | --- |
| `200` | The `DatasetPreview` contract below. |
| `400 VALIDATION_FAILED` | The version is not a CSV or XLSX. |
| `404` | Non-member, unknown workspace/source, or a version that does not belong to that source. |
| `409 CONFLICT` | The version is not `READY` yet (or failed), or has no stored profile. The UI shows "not available yet". |

Because a version is immutable, so is its preview: the URL names the version, and the frontend caches it for the session
(`staleTime: Infinity`). Uploading revision 2 does not change the preview of revision 1.

## What it returns

Per file: `sourceId`, `sourceVersionId`, `versionNumber`, `originalFilename`, `sizeBytes`, `contentSha256`, `format`,
`formulasEvaluated` (always `false`), `truncated`, the `limits` it was built under, and `warnings`.

Per sheet (CSV is the single sheet `CSV`): `name`, `state` (`visible`/`hidden`/`veryHidden`), `headerRow`,
`formulaPresence`, `dimensions` (`usedRange`, `rowCount`, `dataRowCount`, `rowCountEstimated`, `scannedRows`,
`columnCount`), `columns[]` (name, `inferredType`, `missingValues`, `profiledValues`, `missingValuesExact`) and
`sampleRows[]` (data rows only, one cell per listed column). Semantics, including how XLSX types are separated from the
header cell and how counts are marked as estimates, are in the
[contract README](../../contracts/analysis/dataset-preview/v1/README.md).

| Requirement | How it is met |
| --- | --- |
| XLSX: sheet names, dimensions, header, inferred types, bounded sample rows, missing-value summary | `sheets[]` as above; hidden sheets are listed with their `state`. |
| CSV: columns, row count or estimate, sample rows, type inference | `rowCount`/`dataRowCount` are exact when the scan completed, otherwise `null` with `scannedRows` and a `ROW_COUNT_ESTIMATED` warning. |
| Workspace-authorized | `SourceService.findVersion` / `SourceExtractionService.findVersionWorkbook` authorize by workspace, source and version before anything is read. |
| Cap cells and response bytes | sheets ≤ 10, columns ≤ 100 and cells ≤ 300 across the file (shared equally between sheets), ≤ 10 sample rows per sheet, values ≤ 96 UTF-8 bytes, whole JSON ≤ 65 536 bytes. |
| No formula execution | A formula is the text the worker extracted. No file is opened on the request path; the worker reads workbooks with `data_only=False` and `read_only=True`. The UI renders every value as a text node. |

Nothing is silently dropped: the response lists every cut (`SHEETS_OMITTED`, `ROWS_TRUNCATED`, `COLUMNS_TRUNCATED`,
`VALUES_SHORTENED`, `RESPONSE_SIZE_CAPPED`), what is only an estimate (`ROW_COUNT_ESTIMATED`,
`MISSING_VALUES_PARTIAL`, `TYPES_INFERRED`), and that formulas were not calculated (`FORMULAS_NOT_EVALUATED`).
Control characters become a space so a hostile file cannot make the JSON escape grow past the byte cap, and if the
serialized preview would still exceed 64 KiB, sample rows are dropped (and `RESPONSE_SIZE_CAPPED` is reported) instead
of failing the request.

## Java and Python are one contract

`dev.researchhub.analysis.application.DatasetPreviewBuilder` (Spring) and
`researchhub_worker.data.build_dataset_preview` (worker, `ai-worker/src/researchhub_worker/data/`) implement the same
algorithm. The Python Pydantic models are the machine-readable contract: `dataset-preview.schema.json` is generated from
them and checked for drift, and an analysis planner running in the worker validates the Spring response with
`DatasetPreview.model_validate`. Both builders are tested against the same fixtures (`csv-preview.json`,
`xlsx-preview.json`, and a deliberately hostile `large-preview.json`), so a behavioural change must change both and the
fixtures. No new service, dependency, database access or runtime was introduced; the preview is a read-only projection
inside the existing modular monolith (`analysis` module, see [backend-architecture.md](backend-architecture.md)).

## Frontend (`frontend/src/features/analysis/`)

`DatasetPreviewPanel` is rendered on the source page for a `READY` CSV/XLSX version:

* **source header** – type tile, display name, selected sheet/counts, original filename, format, version (`latest` or
  `older version`), size and short SHA-256;
* **sheet tabs** – keyboard navigation with arrows/Home/End, exact data-row counts when known, hidden sheets labelled;
  starts on the first visible sheet (or the first available one). Switching sheets uses the cached bounded response;
* **counts** – data rows (`about` when estimated, "unknown (the first N rows were scanned)" when not known), columns
  (`10 of 120 shown`), used range and header row;
* **column types** – a table of name, inferred type and missing values (`2 of 5 sampled` unless exact);
* **table preview** – inert sample values under typed column headers (numeric/text badges), physical row numbers,
  sticky headers and a keyboard-scrollable region. The sheet details sit beside the grid on a wide screen and below it
  on a narrow screen; unknown totals stay unknown;
* **warnings** – always-visible banners above the grid listing every cut and notes about estimates and inferred types.
  The six server limits and the fact that formulas are never calculated remain visible, including for empty sheets;
* **Analyze this data** – hands `{sourceId, sourceVersionId, sheetName}` to the page, which opens the workspace questions
  with that source already selected (`?analyzeSource=…&analyzeVersion=…&analyzeSheet=…`) and a starter question. It is
  disabled for an older version because search and questions use the latest;
* **Ask about data** – opens the existing source-scoped questions page (`/ask?askSource=…`), also disabled for an older
  preview. Existing source metadata, download and source-level question actions remain available.

A very large file renders the same few rows as a small one, so the page stays responsive. The panel makes one request.
The RH-304 layout follows `design-reference/Sources.pdf`, page 4, without load-more controls, histograms, added statistics
or changes to the preview API, processing limits, dependencies or schema.

## Verification

* `DatasetPreviewBuilderTest` – parity with the shared fixtures, hostile values, byte budget, type inference, caps.
* `DatasetPreviewServiceTest`, `DatasetPreviewApiIntegrationTest` – authorization, `400`/`409`, bounded output, an older
  version's preview unchanged by a newer version, over real HTTP and PostgreSQL.
* `SourceExtractionEndToEndTest` – upload → real Python worker → PostgreSQL → preview, a replaced CSV, an XLSX with hidden
  sheets, and truncation reported by the real worker.
* `ai-worker/tests/test_data_preview.py` – the same contract in Python, fixture generation, schema drift.
* `frontend/src/features/analysis/**/*.test.ts(x)` and `SourceDetailPage.versions.test.tsx` – every UI state above.
* Coverage gates (≥ 80 %): `./mvnw verify` (`dev/researchhub/analysis/**`), `scripts/check.sh` (`researchhub_worker/data`),
  `npm run test:coverage` (`src/features/analysis/`).
