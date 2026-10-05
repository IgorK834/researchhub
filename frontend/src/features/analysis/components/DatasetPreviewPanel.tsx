import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/components/Button';
import { DataTable, DashedNote, Panel } from '../../../shared/components/content';
import { Tabs } from '../../../shared/components/navigation';
import { Icon } from '../../../shared/components/icons';
import { SourceTypeTile } from '../../sources/components/SourceVisuals';
import { describeError, hasApiErrorCode } from '../../../shared/api';
import type {
  DatasetPreview,
  InferredType,
  PreviewSheet,
  PreviewWarning,
} from '../api/datasetPreviewApi';
import { useDatasetPreviewQuery } from '../api/useDatasetPreview';
import styles from './DatasetPreviewPanel.module.css';

/** The exact immutable version and sheet handed to the existing analysis/question flow. */
export interface AnalyzeTarget {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sheetName: string;
}
export interface DatasetPreviewPanelProps {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  /** A source's display name; the version's original filename remains in its provenance. */
  readonly sourceName?: string;
  /** Existing source metadata/actions, placed below the sheet details by the source page. */
  readonly sourceInfo?: ReactNode;
  /** Questions and analysis use the latest source version, so older-preview actions are disabled. */
  readonly isLatestVersion?: boolean;
  readonly onAnalyze?: (target: AnalyzeTarget) => void;
  readonly onAsk?: () => void;
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

/** One server-bounded, read-only projection. No workbook download, parsing or formula evaluation. */
export function DatasetPreviewPanel({
  workspaceId,
  sourceId,
  sourceVersionId,
  sourceName,
  sourceInfo,
  isLatestVersion = true,
  onAnalyze,
  onAsk,
}: DatasetPreviewPanelProps): ReactElement {
  const preview = useDatasetPreviewQuery(workspaceId, sourceId, sourceVersionId);
  if (preview.isPending || preview.error !== null)
    return (
      <div className={styles.viewer}>
        {sourceName === undefined ? null : <h1>{sourceName}</h1>}
        <div className={styles.layout}>
          {preview.isPending ? (
            <p role="status">Loading dataset preview…</p>
          ) : (
            <Panel title="Dataset preview">
              <p role={hasApiErrorCode(preview.error, 'CONFLICT') ? 'status' : 'alert'}>
                {hasApiErrorCode(preview.error, 'CONFLICT')
                  ? 'The dataset structure is not available yet. It appears once this version has been processed.'
                  : `Could not load dataset preview: ${describeError(preview.error)}`}
              </p>
            </Panel>
          )}
          {sourceInfo}
        </div>
      </div>
    );
  return (
    <PreviewContent
      key={preview.data.sourceVersionId}
      data={preview.data}
      sourceName={sourceName}
      sourceInfo={sourceInfo}
      isLatestVersion={isLatestVersion}
      onAnalyze={onAnalyze}
      onAsk={onAsk}
    />
  );
}

function PreviewContent({
  data,
  sourceName,
  sourceInfo,
  isLatestVersion,
  onAnalyze,
  onAsk,
}: {
  readonly data: DatasetPreview;
  readonly sourceName?: string;
  readonly sourceInfo?: ReactNode;
  readonly isLatestVersion: boolean;
  readonly onAnalyze?: (target: AnalyzeTarget) => void;
  readonly onAsk?: () => void;
}): ReactElement {
  const firstVisible = data.sheets.find((sheet) => sheet.state === 'visible');
  const [selectedName, setSelectedName] = useState(
    (firstVisible ?? data.sheets[0])?.name,
  );
  const sheet = data.sheets.find((candidate) => candidate.name === selectedName);
  return (
    <section aria-label="Dataset preview" className={styles.viewer}>
      <h2 className="visually-hidden">Dataset preview</h2>
      <header className={styles.header}>
        <SourceTypeTile sourceType={data.format} />
        <div className={styles.title}>
          <h1>{sourceName ?? data.originalFilename}</h1>
          <p>
            {data.format} · {data.sheets.length}{' '}
            {data.sheets.length === 1 ? 'sheet' : 'sheets'} in this preview
            {sheet === undefined
              ? ''
              : ` · ${sheet.name} · ${rowCount(sheet)} data rows · ${columnCount(sheet)} columns`}
          </p>
          <dl aria-label="Source version" className={styles.version}>
            <dt>File</dt>
            <dd>{data.originalFilename}</dd>
            <dt>Version</dt>
            <dd>
              {data.versionNumber} {isLatestVersion ? '(latest)' : '(older version)'}
            </dd>
            <dt>Size</dt>
            <dd>{count(data.sizeBytes)} bytes</dd>
            <dt>SHA-256</dt>
            <dd>
              <code title={data.contentSha256}>{data.contentSha256.slice(0, 12)}…</code>
            </dd>
          </dl>
        </div>
        <div className={styles.actions}>
          {onAnalyze === undefined ? null : (
            <Button
              icon="chart"
              disabled={!isLatestVersion || sheet === undefined}
              onClick={() => {
                if (sheet !== undefined)
                  onAnalyze({
                    sourceId: data.sourceId,
                    sourceVersionId: data.sourceVersionId,
                    sheetName: sheet.name,
                  });
              }}
            >
              Analyze this data
            </Button>
          )}
          {onAsk === undefined ? null : (
            <Button
              variant="secondary"
              icon="sparkle"
              disabled={!isLatestVersion}
              onClick={onAsk}
            >
              Ask about data
            </Button>
          )}
          {isLatestVersion || (onAnalyze === undefined && onAsk === undefined) ? null : (
            <p>Analysis and questions use the latest version of this source.</p>
          )}
        </div>
      </header>
      <LimitNotice data={data} />
      <SheetWarnings warnings={data.warnings} sheetName={sheet?.name} />
      <DashedNote>
        Formulas are shown as text and are never calculated. The preview is limited to{' '}
        {data.limits.maxSampleRows} rows per sheet, {data.limits.maxColumns} columns per
        sheet, {data.limits.maxSheets} sheets, {data.limits.maxCells} cells and{' '}
        {count(data.limits.maxResponseBytes)} bytes in total. Each value is limited to{' '}
        {data.limits.maxCellBytes} UTF-8 bytes.
      </DashedNote>
      <div className={styles.layout}>
        <div className={styles.main}>
          {sheet === undefined ? (
            <p>This file contains no sheets to preview.</p>
          ) : (
            <div className={styles.sheets}>
              <Tabs
                label="Sheets"
                value={sheet.name}
                onChange={setSelectedName}
                items={data.sheets.map((candidate) => ({
                  value: candidate.name,
                  label:
                    candidate.state === 'visible'
                      ? candidate.name
                      : `${candidate.name} (${candidate.state === 'hidden' ? 'hidden' : 'very hidden'})`,
                  ...(candidate.dimensions.dataRowCount !== null &&
                  !candidate.dimensions.rowCountEstimated
                    ? { count: candidate.dimensions.dataRowCount }
                    : {}),
                  // Mount only the selected sheet. Hidden tabs never duplicate sample cells or profile tables.
                  content:
                    candidate.name === sheet.name ? (
                      <>
                        <SampleTable sheet={sheet} />
                        <section
                          className={styles.columnInfo}
                          aria-label="Column information"
                        >
                          <h2>Column information</h2>
                          <p>
                            Types and missing-value counts describe the server&apos;s
                            bounded profile.
                          </p>
                          <ColumnTable sheet={sheet} />
                        </section>
                      </>
                    ) : null,
                }))}
              />
            </div>
          )}
        </div>
        <aside className={styles.details} aria-label="Dataset details">
          {sheet === undefined ? null : (
            <Panel title="Sheet details">
              <SheetCounts sheet={sheet} />
            </Panel>
          )}
          {sourceInfo}
        </aside>
      </div>
    </section>
  );
}

function LimitNotice({ data }: { readonly data: DatasetPreview }): ReactElement | null {
  const limits = data.warnings.filter((warning) => LIMIT_CODES.has(warning.code));
  const truncated = data.truncated || data.sheets.some((sheet) => sheet.truncated);
  if (!truncated && limits.length === 0) return null;
  return (
    <div role="status" aria-label="Preview limits" className={styles.banner}>
      <Icon name="warn" />
      <div>
        <p>
          <strong>
            {truncated ? 'This preview is truncated.' : 'Preview limit notes.'}
          </strong>{' '}
          It shows a bounded sample, not the whole dataset.
        </p>
        {limits.length === 0 ? null : (
          <ul>
            {limits.map((warning, index) => (
              <li key={index}>
                {warning.sheet === null ? '' : `${warning.sheet}: `}
                {warning.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function SheetWarnings({
  warnings,
  sheetName,
}: {
  readonly warnings: readonly PreviewWarning[];
  readonly sheetName: string | undefined;
}): ReactElement | null {
  const notes = warnings.filter(
    (warning) =>
      !LIMIT_CODES.has(warning.code) &&
      (warning.sheet === null || warning.sheet === sheetName),
  );
  if (notes.length === 0) return null;
  return (
    <div role="status" aria-label="Notes about this preview" className={styles.banner}>
      <Icon name="info" />
      <div>
        <strong>Preview notes</strong>
        <ul>
          {notes.map((warning, index) => (
            <li key={index}>{warning.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
function count(value: number): string {
  return value.toLocaleString();
}
function rowCount({ dimensions }: PreviewSheet): string {
  return dimensions.dataRowCount === null
    ? `unknown (the first ${count(dimensions.scannedRows)} rows were scanned)`
    : `${dimensions.rowCountEstimated ? 'about ' : ''}${count(dimensions.dataRowCount)}`;
}
function columnCount(sheet: PreviewSheet): string {
  const total = sheet.dimensions.columnCount;
  if (total === null) return `${count(sheet.columns.length)} shown (total unknown)`;
  return sheet.columns.length === total
    ? count(total)
    : `${count(sheet.columns.length)} of ${count(total)} shown`;
}
function SheetCounts({ sheet }: { readonly sheet: PreviewSheet }): ReactElement {
  return (
    <dl aria-label="Sheet size" className={styles.counts}>
      <dt>Sheet</dt>
      <dd>{sheet.name}</dd>
      <dt>Visibility</dt>
      <dd>{sheet.state === 'veryHidden' ? 'very hidden' : sheet.state}</dd>
      <dt>Data rows</dt>
      <dd>{rowCount(sheet)}</dd>
      <dt>Columns</dt>
      <dd>{columnCount(sheet)}</dd>
      {sheet.dimensions.usedRange === null ? null : (
        <>
          <dt>Used range</dt>
          <dd>{sheet.dimensions.usedRange}</dd>
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
  if (sheet.sampleRows.length === 0 || sheet.columns.length === 0)
    return <p>No sample rows are available for this sheet.</p>;
  const total = sheet.dimensions.dataRowCount;
  return (
    <div
      role="region"
      aria-label={`${sheet.name} sample rows`}
      tabIndex={0}
      className={styles.grid}
    >
      <table aria-label={`${sheet.name} dataset preview`}>
        <caption>
          Sample rows ({sheet.sampleRows.length}
          {total === null
            ? ''
            : ` of ${sheet.dimensions.rowCountEstimated ? 'about ' : ''}${count(total)}`}
          )
        </caption>
        <thead>
          <tr>
            <th scope="col">Row</th>
            {sheet.columns.map((column) => (
              <th scope="col" key={column.index}>
                <span className={styles.columnHeader}>
                  <span
                    className={styles.type}
                    data-type={column.inferredType}
                    aria-label={`Inferred type: ${TYPE_LABELS[column.inferredType]}`}
                    title={`Inferred type: ${TYPE_LABELS[column.inferredType]}`}
                  >
                    {column.inferredType === 'INTEGER' || column.inferredType === 'NUMBER'
                      ? '123'
                      : column.inferredType === 'TEXT'
                        ? 'abc'
                        : TYPE_LABELS[column.inferredType]}
                  </span>
                  <span>{column.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.sampleRows.map((row) => (
            <tr key={row.rowNumber}>
              <th scope="row">{row.rowNumber}</th>
              {sheet.columns.map((column, position) => (
                <td key={column.index}>{row.cells[position] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
