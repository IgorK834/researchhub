# Dataset preview v1 (RH-131)

A bounded, formula-inert description of **one immutable CSV/XLSX source version**, served to the browser by
`GET /api/workspaces/{workspaceId}/analysis/datasets/{sourceId}/versions/{versionId}/preview` and to the future
analysis planner. It is a projection of the extraction profile the worker already produced when the version was
processed (`workbook` / `csvProfile` in [processing v4](../../../processing/v4)); no file is opened or parsed on the
request path and no formula is ever evaluated.

| File | Purpose |
| --- | --- |
| `dataset-preview.schema.json` | JSON Schema generated from the Pydantic models in `ai-worker/src/researchhub_worker/data/contracts.py`. A test fails when it drifts. |
| `csv-preview.json`, `xlsx-preview.json` | Expected output for the shared processing fixtures `source-ingest-result-csv.json` and `source-ingest-result-workbook.json`. |
| `large-workbook.json`, `large-preview.json` | A deterministic workbook that exercises every cap (12 sheets, 120 columns, 5000 rows, control characters, an oversized value, an unknown row count) and the expected capped output. |

The Spring `DatasetPreviewBuilder` and the Python `build_dataset_preview` are two implementations of one algorithm.
Both are tested against these fixtures, so a behavioural change has to change both implementations and the fixtures:

```bash
cd ai-worker && UPDATE_CONTRACT_FIXTURES=1 uv run --frozen pytest tests/test_data_preview.py   # then review the diff
cd backend && ./mvnw test -Dtest=DatasetPreviewBuilderTest
```

## Semantics

* **Identity and provenance.** `sourceId`, `sourceVersionId`, `versionNumber`, `originalFilename`, `sizeBytes` and
  `contentSha256` name the exact uploaded bytes the structure describes. A preview of an old version never changes
  when a newer version is uploaded.
* **Data rows only.** `sampleRows` start after the header row. `rowNumber` is the physical 1-based row of the sheet and
  every row has exactly one entry per listed column (missing cells are `""`). The header is described by `columns[].name`
  and `headerRow`; the first non-empty row is assumed to be the header (CSV/XLSX alike).
* **Counts.** `dimensions.rowCount` includes the header row, `dataRowCount` excludes it; both are `null` when the bounded
  scan stopped early and no estimate exists. `rowCountEstimated` says whether they are an estimate; `scannedRows` is how
  many rows the scan actually examined. `columnCount` is the sheet's total, which may exceed `columns.length`.
* **Missing values.** `missingValues` counts empty or whitespace-only cells among `profiledValues` data rows.
  `missingValuesExact` is true only when those rows are every row of the sheet.
* **Types.** `inferredType` is one of `INTEGER`, `NUMBER`, `BOOLEAN`, `DATE`, `TEXT`, `FORMULA`, `ERROR`, `MIXED`,
  `UNKNOWN`. CSV types come from the worker's data-row profile. XLSX types come from the worker's cell kinds; the header
  cell (usually text) is separated from the data by looking at the sampled values, so a numeric column with a text
  header is `NUMBER`, not `MIXED`. All types describe a bounded sample and may be wrong (`TYPES_INFERRED`).
* **Formulas.** XLSX formulas are the literal text the worker read (`=B2*2`); `formulasEvaluated` is always `false`.
* **Hidden sheets** are listed with `state` `hidden` or `veryHidden`; a client should label them.

## Caps and truncation

| Cap | Value |
| --- | --- |
| sheets listed | 10 (`SHEETS_OMITTED` otherwise) |
| columns, all sheets together | 100, shared equally (`COLUMNS_TRUNCATED`) |
| cells, all sheets together | 300; at most 10 sample rows per sheet (`ROWS_TRUNCATED`) |
| one value | 96 UTF-8 bytes, cut on a character boundary (`VALUES_SHORTENED`); control characters become a space |
| the whole serialized response | 65 536 bytes; sample rows are dropped, never the response (`RESPONSE_SIZE_CAPPED`) |

`truncated` is true when any of `SHEETS_OMITTED`, `ROWS_TRUNCATED`, `COLUMNS_TRUNCATED`, `VALUES_SHORTENED` or
`RESPONSE_SIZE_CAPPED` applies. `warnings[].code` is stable and machine readable; `message` is for people.
Full documentation: [dataset inspection](../../../../docs/development/dataset-inspection.md).
