import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  get INTEGER() {
    return uiText('ui.DatasetPreviewPanel.message059');
  },
  get NUMBER() {
    return uiText('ui.DatasetPreviewPanel.message060');
  },
  get BOOLEAN() {
    return uiText('ui.DatasetPreviewPanel.message061');
  },
  get DATE() {
    return uiText('ui.DatasetPreviewPanel.message062');
  },
  get TEXT() {
    return uiText('ui.DatasetPreviewPanel.message063');
  },
  get FORMULA() {
    return uiText('ui.DatasetPreviewPanel.message064');
  },
  get ERROR() {
    return uiText('ui.DatasetPreviewPanel.message065');
  },
  get MIXED() {
    return uiText('ui.DatasetPreviewPanel.message066');
  },
  get UNKNOWN() {
    return uiText('ui.DatasetPreviewPanel.message067');
  },
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
  useUiLocale();
  const preview = useDatasetPreviewQuery(workspaceId, sourceId, sourceVersionId);
  if (preview.isPending || preview.error !== null)
    return (
      <div className={styles.viewer}>
        {sourceName === undefined ? null : <h1>{sourceName}</h1>}
        <div className={styles.layout}>
          {preview.isPending ? (
            <p role="status">{uiText('ui.DatasetPreviewPanel.message001')}</p>
          ) : (
            <Panel title={uiText('ui.DatasetPreviewPanel.message002')}>
              <p role={hasApiErrorCode(preview.error, 'CONFLICT') ? 'status' : 'alert'}>
                {hasApiErrorCode(preview.error, 'CONFLICT')
                  ? uiText('ui.DatasetPreviewPanel.message003')
                  : uiText('ui.DatasetPreviewPanel.message004', {
                      value0: describeError(preview.error),
                    })}
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
  useUiLocale();
  const firstVisible = data.sheets.find((sheet) => sheet.state === 'visible');
  const [selectedName, setSelectedName] = useState(
    (firstVisible ?? data.sheets[0])?.name,
  );
  const sheet = data.sheets.find((candidate) => candidate.name === selectedName);
  return (
    <section
      aria-label={uiText('ui.DatasetPreviewPanel.message002')}
      className={styles.viewer}
    >
      <h2 className="visually-hidden">{uiText('ui.DatasetPreviewPanel.message002')}</h2>
      <header className={styles.header}>
        <SourceTypeTile sourceType={data.format} />
        <div className={styles.title}>
          <h1>{sourceName ?? data.originalFilename}</h1>
          <p>
            {data.format} · {data.sheets.length}{' '}
            {data.sheets.length === 1
              ? uiText('ui.DatasetPreviewPanel.message005')
              : uiText('ui.DatasetPreviewPanel.message006')}{' '}
            {uiText('ui.DatasetPreviewPanel.message007')}
            {sheet === undefined
              ? ''
              : ' ' +
                uiText('ui.DatasetPreviewPanel.message008', {
                  value0: sheet.name,
                  value1: rowCount(sheet),
                  value2: columnCount(sheet),
                })}
          </p>
          <dl
            aria-label={uiText('ui.DatasetPreviewPanel.message009')}
            className={styles.version}
          >
            <dt>{uiText('ui.DatasetPreviewPanel.message010')}</dt>
            <dd>{data.originalFilename}</dd>
            <dt>{uiText('ui.AnalysisStudio.message004')}</dt>
            <dd>
              {data.versionNumber}{' '}
              {isLatestVersion
                ? uiText('ui.DatasetPreviewPanel.message011')
                : uiText('ui.DatasetPreviewPanel.message012')}
            </dd>
            <dt>{uiText('ui.DatasetPreviewPanel.message013')}</dt>
            <dd>
              {count(data.sizeBytes)} {uiText('ui.AnalysisProvenance.message027')}
            </dd>
            <dt>{uiText('ui.AnalysisWidgets.message008')}</dt>
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
              {uiText('ui.DatasetPreviewPanel.message014')}
            </Button>
          )}
          {onAsk === undefined ? null : (
            <Button
              variant="secondary"
              icon="sparkle"
              disabled={!isLatestVersion}
              onClick={onAsk}
            >
              {uiText('ui.DatasetPreviewPanel.message015')}
            </Button>
          )}
          {isLatestVersion || (onAnalyze === undefined && onAsk === undefined) ? null : (
            <p>{uiText('ui.DatasetPreviewPanel.message016')}</p>
          )}
        </div>
      </header>
      <LimitNotice data={data} />
      <SheetWarnings warnings={data.warnings} sheetName={sheet?.name} />
      <DashedNote>
        {uiText('ui.DatasetPreviewPanel.message017')} {data.limits.maxSampleRows}{' '}
        {uiText('ui.DatasetPreviewPanel.message018')} {data.limits.maxColumns}{' '}
        {uiText('ui.DatasetPreviewPanel.message019')} {data.limits.maxSheets}{' '}
        {uiText('ui.DatasetPreviewPanel.message020')} {data.limits.maxCells}{' '}
        {uiText('ui.DatasetPreviewPanel.message021')}{' '}
        {count(data.limits.maxResponseBytes)}{' '}
        {uiText('ui.DatasetPreviewPanel.message022')} {data.limits.maxCellBytes}{' '}
        {uiText('ui.DatasetPreviewPanel.message023')}
      </DashedNote>
      <div className={styles.layout}>
        <div className={styles.main}>
          {sheet === undefined ? (
            <p>{uiText('ui.DatasetPreviewPanel.message024')}</p>
          ) : (
            <div className={styles.sheets}>
              <Tabs
                label={uiText('ui.DatasetPreviewPanel.message025')}
                value={sheet.name}
                onChange={setSelectedName}
                items={data.sheets.map((candidate) => ({
                  value: candidate.name,
                  label:
                    candidate.state === 'visible'
                      ? candidate.name
                      : `${candidate.name} (${candidate.state === 'hidden' ? 'hidden' : uiText('ui.DatasetPreviewPanel.message026')})`,
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
                          aria-label={uiText('ui.DatasetPreviewPanel.message027')}
                        >
                          <h2>{uiText('ui.DatasetPreviewPanel.message027')}</h2>
                          <p>{uiText('ui.DatasetPreviewPanel.message028')}</p>
                          <ColumnTable sheet={sheet} />
                        </section>
                      </>
                    ) : null,
                }))}
              />
            </div>
          )}
        </div>
        <aside
          className={styles.details}
          aria-label={uiText('ui.DatasetPreviewPanel.message029')}
        >
          {sheet === undefined ? null : (
            <Panel title={uiText('ui.DatasetPreviewPanel.message030')}>
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
  useUiLocale();
  const limits = data.warnings.filter((warning) => LIMIT_CODES.has(warning.code));
  const truncated = data.truncated || data.sheets.some((sheet) => sheet.truncated);
  if (!truncated && limits.length === 0) return null;
  return (
    <div
      role="status"
      aria-label={uiText('ui.DatasetPreviewPanel.message031')}
      className={styles.banner}
    >
      <Icon name="warn" />
      <div>
        <p>
          <strong>
            {truncated
              ? uiText('ui.DatasetPreviewPanel.message032')
              : uiText('ui.DatasetPreviewPanel.message033')}
          </strong>{' '}
          {uiText('ui.DatasetPreviewPanel.message034')}
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
  useUiLocale();
  const notes = warnings.filter(
    (warning) =>
      !LIMIT_CODES.has(warning.code) &&
      (warning.sheet === null || warning.sheet === sheetName),
  );
  if (notes.length === 0) return null;
  return (
    <div
      role="status"
      aria-label={uiText('ui.DatasetPreviewPanel.message035')}
      className={styles.banner}
    >
      <Icon name="info" />
      <div>
        <strong>{uiText('ui.DatasetPreviewPanel.message036')}</strong>
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
  return value.toLocaleString(getIntlLocale());
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
  useUiLocale();
  return (
    <dl
      aria-label={uiText('ui.DatasetPreviewPanel.message037')}
      className={styles.counts}
    >
      <dt>{uiText('ui.DatasetPreviewPanel.message038')}</dt>
      <dd>{sheet.name}</dd>
      <dt>{uiText('ui.DatasetPreviewPanel.message039')}</dt>
      <dd>
        {sheet.state === 'veryHidden'
          ? uiText('ui.DatasetPreviewPanel.message026')
          : sheet.state}
      </dd>
      <dt>{uiText('ui.DatasetPreviewPanel.message040')}</dt>
      <dd>{rowCount(sheet)}</dd>
      <dt>{uiText('ui.DatasetPreviewPanel.message041')}</dt>
      <dd>{columnCount(sheet)}</dd>
      {sheet.dimensions.usedRange === null ? null : (
        <>
          <dt>{uiText('ui.DatasetPreviewPanel.message042')}</dt>
          <dd>{sheet.dimensions.usedRange}</dd>
        </>
      )}
      <dt>{uiText('ui.DatasetPreviewPanel.message043')}</dt>
      <dd>{sheet.headerRow ?? uiText('ui.DatasetPreviewPanel.message044')}</dd>
    </dl>
  );
}
function ColumnTable({ sheet }: { readonly sheet: PreviewSheet }): ReactElement {
  useUiLocale();
  if (sheet.columns.length === 0)
    return <p>{uiText('ui.DatasetPreviewPanel.message045')}</p>;
  return (
    <DataTable
      label={uiText('ui.DatasetPreviewPanel.message046', { value0: sheet.name })}
      caption={uiText('ui.DatasetPreviewPanel.message047')}
      rows={sheet.columns}
      rowKey={(column) => column.index}
      columns={[
        { id: 'index', header: '#', render: (column) => column.index },
        {
          id: 'name',
          get header() {
            return uiText('ui.AnalysisProvenance.message007');
          },
          rowHeader: true,
          render: (column) => column.name,
        },
        {
          id: 'type',
          get header() {
            return uiText('ui.DatasetPreviewPanel.message048');
          },
          render: (column) => TYPE_LABELS[column.inferredType],
        },
        {
          id: 'missing',
          get header() {
            return uiText('ui.DatasetPreviewPanel.message049');
          },
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
  useUiLocale();
  if (sheet.sampleRows.length === 0 || sheet.columns.length === 0)
    return <p>{uiText('ui.DatasetPreviewPanel.message050')}</p>;
  const total = sheet.dimensions.dataRowCount;
  return (
    <div
      role="region"
      aria-label={uiText('ui.DatasetPreviewPanel.message051', { value0: sheet.name })}
      tabIndex={0}
      className={styles.grid}
    >
      <table
        aria-label={uiText('ui.DatasetPreviewPanel.message052', { value0: sheet.name })}
      >
        <caption>
          {uiText('ui.DatasetPreviewPanel.message053')}
          {sheet.sampleRows.length}
          {total === null
            ? ''
            : ' ' +
              uiText('ui.DatasetPreviewPanel.message054', {
                value0: sheet.dimensions.rowCountEstimated
                  ? uiText('ui.DatasetPreviewPanel.message055') + ' '
                  : '',
                value1: count(total),
              })}
          )
        </caption>
        <thead>
          <tr>
            <th scope="col">{uiText('ui.DatasetPreviewPanel.message056')}</th>
            {sheet.columns.map((column) => (
              <th scope="col" key={column.index}>
                <span className={styles.columnHeader}>
                  <span
                    className={styles.type}
                    data-type={column.inferredType}
                    aria-label={uiText('ui.DatasetPreviewPanel.message057', {
                      value0: TYPE_LABELS[column.inferredType],
                    })}
                    title={uiText('ui.DatasetPreviewPanel.message057', {
                      value0: TYPE_LABELS[column.inferredType],
                    })}
                  >
                    {column.inferredType === 'INTEGER' || column.inferredType === 'NUMBER'
                      ? '123'
                      : column.inferredType === 'TEXT'
                        ? uiText('ui.DatasetPreviewPanel.message058')
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
