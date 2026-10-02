import { useState, type ReactElement } from 'react';

import { DataTable } from '../../../shared/components/content';

import { describeError, hasApiErrorCode } from '../../../shared/api';
import type {
  DatasetPreview,
  InferredType,
  PreviewSheet,
  PreviewWarning,
} from '../api/datasetPreviewApi';
import { useDatasetPreviewQuery } from '../api/useDatasetPreview';

/** What "Analyze this data" hands to the page: the exact immutable version and sheet being looked at. */
export interface AnalyzeTarget {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sheetName: string;
}

const TYPE_LABELS: Readonly<Record<InferredType, string>> = {
  INTEGER: 'integer',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  TEXT: 'text',
  FORMULA: 'formula (text)',
  ERROR: 'error value',
  MIXED: 'mixed',
  UNKNOWN: 'unknown',
};

const LIMIT_CODES: ReadonlySet<string> = new Set([
  'SHEETS_OMITTED',
  'ROWS_TRUNCATED',
  'COLUMNS_TRUNCATED',
  'VALUES_SHORTENED',
  'RESPONSE_SIZE_CAPPED',
]);

/**
 * Bounded, read-only look at one immutable CSV/XLSX source version. The server caps what it sends, so a very large
 * file renders the same few rows as a small one; the panel never downloads or parses the workbook itself.
 */
export function DatasetPreviewPanel({
  workspaceId,
  sourceId,
  sourceVersionId,
  isLatestVersion = true,
  onAnalyze,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  /** False when a newer version exists; "Analyze this data" is then disabled because analysis uses the latest. */
  readonly isLatestVersion?: boolean;
  readonly onAnalyze?: (target: AnalyzeTarget) => void;
}): ReactElement {
  const preview = useDatasetPreviewQuery(workspaceId, sourceId, sourceVersionId);
  if (preview.isPending) return <p role="status">Loading dataset preview…</p>;
  if (preview.error !== null) {
    return (
      <section aria-label="Dataset preview">
        <h2>Dataset preview</h2>
        <p role={hasApiErrorCode(preview.error, 'CONFLICT') ? 'status' : 'alert'}>
          {hasApiErrorCode(preview.error, 'CONFLICT')
            ? 'The dataset structure is not available yet. It appears once this version has been processed.'
            : `Could not load dataset preview: ${describeError(preview.error)}`}
        </p>
      </section>
    );
  }
  // A new version (or a new source) starts from its own first sheet.
  return (
    <PreviewContent
      key={preview.data.sourceVersionId}
      data={preview.data}
      isLatestVersion={isLatestVersion}
      {...(onAnalyze === undefined ? {} : { onAnalyze })}
    />
  );
}

function PreviewContent({
  data,
  isLatestVersion,
  onAnalyze,
}: {
  readonly data: DatasetPreview;
  readonly isLatestVersion: boolean;
  readonly onAnalyze?: (target: AnalyzeTarget) => void;
}): ReactElement {
  const firstVisible = data.sheets.find((sheet) => sheet.state === 'visible');
  const [selectedName, setSelectedName] = useState<string | undefined>(
    (firstVisible ?? data.sheets[0])?.name,
  );
  const sheet = data.sheets.find((candidate) => candidate.name === selectedName);

  return (
    <section aria-labelledby="dataset-preview-heading">
      <h2 id="dataset-preview-heading">Dataset preview</h2>
      <SourceHeader data={data} isLatestVersion={isLatestVersion} />
      <LimitNotice data={data} />
      {sheet === undefined ? (
        <p>This file contains no sheets to preview.</p>
      ) : (
        <>
          {data.sheets.length > 1 ? (
            <p>
              <label htmlFor="dataset-sheet">Sheet</label>{' '}
              <select
                id="dataset-sheet"
                value={sheet.name}
                onChange={(event) => setSelectedName(event.target.value)}
              >
                {data.sheets.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.state === 'visible'
                      ? candidate.name
                      : `${candidate.name} (${candidate.state === 'hidden' ? 'hidden' : 'very hidden'})`}
                  </option>
                ))}
              </select>
            </p>
          ) : null}
          <SheetCounts sheet={sheet} />
          <SheetWarnings warnings={data.warnings} sheetName={sheet.name} />
          <ColumnTable sheet={sheet} />
          <SampleTable sheet={sheet} />
          {onAnalyze === undefined ? null : (
            <p>
              <button
                type="button"
                disabled={!isLatestVersion}
                onClick={() =>
                  onAnalyze({
                    sourceId: data.sourceId,
                    sourceVersionId: data.sourceVersionId,
                    sheetName: sheet.name,
                  })
                }
              >
                Analyze this data
              </button>
              {isLatestVersion ? null : (
                <small> Analysis uses the latest version of this source.</small>
              )}
            </p>
          )}
        </>
      )}
      <p>
        <small>
          Formulas are shown as text and are never calculated. The preview is limited to{' '}
          {data.limits.maxSampleRows} rows per sheet, {data.limits.maxCells} cells and{' '}
          {data.limits.maxResponseBytes.toLocaleString()} bytes in total.
        </small>
      </p>
    </section>
  );
}

function SourceHeader({
  data,
  isLatestVersion,
}: {
  readonly data: DatasetPreview;
  readonly isLatestVersion: boolean;
}): ReactElement {
  return (
    <dl aria-label="Source version">
      <dt>File</dt>
      <dd>{data.originalFilename}</dd>
      <dt>Format</dt>
      <dd>{data.format}</dd>
      <dt>Version</dt>
      <dd>
        {data.versionNumber} {isLatestVersion ? '(latest)' : '(older version)'}
      </dd>
      <dt>Size</dt>
      <dd>{data.sizeBytes.toLocaleString()} bytes</dd>
      <dt>SHA-256</dt>
      <dd>
        <code title={data.contentSha256}>{data.contentSha256.slice(0, 12)}…</code>
      </dd>
    </dl>
  );
}

function LimitNotice({ data }: { readonly data: DatasetPreview }): ReactElement | null {
  if (!data.truncated) return null;
  const limits = data.warnings.filter((warning) => LIMIT_CODES.has(warning.code));
  return (
    <div role="status" aria-label="Preview limits">
      <p>
        <strong>This preview is truncated.</strong> It shows a bounded sample, not the
        whole dataset.
      </p>
      <ul>
        {limits.map((warning, index) => (
          <li key={`${warning.code}-${warning.sheet ?? ''}-${String(index)}`}>
            {warning.sheet === null ? '' : `${warning.sheet}: `}
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SheetWarnings({
  warnings,
  sheetName,
}: {
  readonly warnings: readonly PreviewWarning[];
  readonly sheetName: string;
}): ReactElement | null {
  const notes = warnings.filter(
    (warning) =>
      !LIMIT_CODES.has(warning.code) &&
      (warning.sheet === null || warning.sheet === sheetName),
  );
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Notes about this preview">
      {notes.map((warning) => (
        <li key={`${warning.code}-${warning.sheet ?? ''}`}>{warning.message}</li>
      ))}
    </ul>
  );
}

function count(value: number): string {
  return value.toLocaleString();
}

function SheetCounts({ sheet }: { readonly sheet: PreviewSheet }): ReactElement {
  const { dimensions } = sheet;
  let rows: string;
  if (dimensions.dataRowCount === null) {
    rows = `unknown (the first ${count(dimensions.scannedRows)} rows were scanned)`;
  } else {
    rows = `${dimensions.rowCountEstimated ? 'about ' : ''}${count(dimensions.dataRowCount)}`;
  }
  const total = dimensions.columnCount ?? sheet.columns.length;
  return (
    <dl aria-label="Sheet size">
      <dt>Data rows</dt>
      <dd>{rows}</dd>
      <dt>Columns</dt>
      <dd>
        {sheet.columns.length === total
          ? count(total)
          : `${count(sheet.columns.length)} of ${count(total)} shown`}
      </dd>
      {dimensions.usedRange === null ? null : (
        <>
          <dt>Used range</dt>
          <dd>{dimensions.usedRange}</dd>
        </>
      )}
      <dt>Header row</dt>
      <dd>{sheet.headerRow ?? 'none'}</dd>
    </dl>
  );
}

function ColumnTable({ sheet }: { readonly sheet: PreviewSheet }): ReactElement {
  if (sheet.columns.length === 0) return <p>This sheet has no columns to describe.</p>;
  return (
    <DataTable
      label={`${sheet.name} column types`}
      caption="Columns and inferred types"
      rows={sheet.columns}
      rowKey={(column) => column.index}
      columns={[
        { id: 'index', header: '#', render: (column) => column.index },
        {
          id: 'name',
          header: 'Column',
          rowHeader: true,
          render: (column) => column.name,
        },
        {
          id: 'type',
          header: 'Type',
          render: (column) => TYPE_LABELS[column.inferredType],
        },
        {
          id: 'missing',
          header: 'Missing values',
          render: (column) =>
            column.profiledValues === 0
              ? '—'
              : `${count(column.missingValues)} of ${count(column.profiledValues)}${column.missingValuesExact ? '' : ' sampled'}`,
        },
      ]}
    />
  );
}

function SampleTable({ sheet }: { readonly sheet: PreviewSheet }): ReactElement {
  if (sheet.sampleRows.length === 0 || sheet.columns.length === 0) {
    return <p>No sample rows are available for this sheet.</p>;
  }
  const total = sheet.dimensions.dataRowCount;
  return (
    <DataTable
      label={`${sheet.name} dataset preview`}
      scrollLabel={`${sheet.name} sample rows`}
      caption={`Sample rows (${sheet.sampleRows.length}${total === null ? '' : ` of ${sheet.dimensions.rowCountEstimated ? 'about ' : ''}${count(total)}`})`}
      rows={sheet.sampleRows}
      rowKey={(row) => row.rowNumber}
      columns={[
        { id: 'row', header: 'Row', rowHeader: true, render: (row) => row.rowNumber },
        ...sheet.columns.map((column, position) => ({
          id: `column-${column.index}`,
          header: column.name,
          render: (row: PreviewSheet['sampleRows'][number]) => row.cells[position] ?? '',
        })),
      ]}
    />
  );
}
