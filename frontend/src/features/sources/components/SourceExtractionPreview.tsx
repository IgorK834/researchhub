import { Panel, DataTable } from '../../../shared/components/content';
import { Button } from '../../../shared/components/Button';
import { useEffect, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import { sourceLocationPath } from '../api/sourceLocations';
import { describeError, queryKeys } from '../../../shared/api';
import { fetchSourceExtraction } from '../api/sourceExtraction';
import { CsvAssetProfile } from './CsvAssetProfile';

export function SourceExtractionPreview({
  workspaceId,
  sourceId,
  revision,
  selectedUnit,
  selectedPage,
  selectedSheet,
  expectedParserVersion,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly revision?: string;
  readonly selectedUnit?: string | null;
  readonly selectedPage?: number | null;
  readonly selectedSheet?: string | null;
  readonly expectedParserVersion?: string | null;
}): ReactElement {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: queryKeys.sourceExtraction(workspaceId, sourceId, revision),
    queryFn: ({ signal }) => fetchSourceExtraction(workspaceId, sourceId, signal),
  });
  useEffect(() => {
    if (!data) return;
    const index = data.chunks.findIndex(
      (unit) =>
        unit.chunkId === selectedUnit ||
        ((selectedUnit === null || selectedUnit === undefined) &&
          (unit.pageNumber === selectedPage ||
            (selectedSheet !== null &&
              selectedSheet !== undefined &&
              unit.location?.sheetName === selectedSheet))),
    );
    if (index >= 0)
      document
        .getElementById(`source-unit-${String(index)}`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [data, selectedUnit, selectedPage, selectedSheet]);
  if (isPending) return <p role="status">Loading extracted content…</p>;
  if (error !== null) {
    return (
      <div>
        <p role="alert">Could not load extracted content: {describeError(error)}</p>
        <Button variant="secondary" type="button" onClick={() => void refetch()}>
          Retry extraction preview
        </Button>
      </div>
    );
  }
  if (data === null) return <p>Extracted content is not available yet.</p>;
  return (
    <Panel title="Extracted content">
      {expectedParserVersion && expectedParserVersion !== data.parserVersion ? (
        <p role="alert">
          This source was reprocessed with a different parser. Check the cited location
          against the original file.
        </p>
      ) : null}
      {selectedUnit && !data.chunks.some((unit) => unit.chunkId === selectedUnit) ? (
        <p role="alert">The requested source location is no longer available.</p>
      ) : null}
      {data.warnings.map((warning, index) => (
        <p role="status" key={index}>
          {warning}
        </p>
      ))}
      {data.workbook === null ? null : (
        <section aria-label="Workbook metadata">
          {data.workbook.csvProfile === undefined ||
          data.workbook.csvProfile === null ? null : (
            <CsvAssetProfile profile={data.workbook.csvProfile} />
          )}
          <h3>Workbook metadata</h3>
          <p>
            Limits: {data.workbook.rowLimit} rows, {data.workbook.columnLimit} columns,{' '}
            {data.workbook.sampleLimit} samples per column.
          </p>
          {data.workbook.sheets.map((sheet) => (
            <section key={sheet.name}>
              <h4>
                {sheet.name} ({sheet.state})
              </h4>
              <p>
                Used range: {sheet.usedRange ?? 'Unknown'}. Estimated rows:{' '}
                {sheet.rowCountEstimate ?? 'Unknown'}. Columns:{' '}
                {sheet.columnCount ?? 'Unknown'}.
              </p>
              <p>
                Sampled rows: {sheet.sampledRows}
                {sheet.truncated ? ' (limited sample)' : ''}.
              </p>
              <p>
                Formulas:{' '}
                {sheet.formulaPresence === null
                  ? 'Unknown outside the sample'
                  : sheet.formulaPresence
                    ? 'Present'
                    : 'Absent'}
                {sheet.formulaScanComplete ? '' : ' (incomplete scan)'}. Formulas are not
                calculated.
              </p>
              <p>
                Header candidate
                {sheet.headerRow === null
                  ? ''
                  : ` (row ${String(sheet.headerRow)})`}:{' '}
                {sheet.headerCandidate.join(' | ') || 'None'}
              </p>
              <h5>First rows</h5>
              {(sheet.previewRows ?? []).length === 0 ? (
                <p>No row preview is available. Reprocess this source to create one.</p>
              ) : (
                <DataTable
                  caption={`${sheet.name} row preview`}
                  rows={sheet.previewRows}
                  rowKey={(row) => row.rowNumber}
                  columns={[
                    {
                      id: 'row',
                      header: 'Row',
                      rowHeader: true,
                      render: (row) => row.rowNumber,
                    },
                    ...Array.from(
                      {
                        length: Math.max(
                          sheet.headerCandidate.length,
                          ...sheet.previewRows.map((row) => row.cells.length),
                        ),
                      },
                      (_, index) => ({
                        id: `column-${String(index)}`,
                        header:
                          sheet.headerCandidate[index] || `Column ${String(index + 1)}`,
                        render: (row: (typeof sheet.previewRows)[number]) =>
                          row.cells[index] ?? '',
                      }),
                    ),
                  ]}
                />
              )}
              <p>
                Preview includes at most {data.workbook?.previewRowLimit ?? 50} rows per
                sheet. Cell values may be shortened to 500 characters.
              </p>
              <DataTable
                caption={`${sheet.name} schema`}
                rows={sheet.columns}
                rowKey={(column) => column.columnNumber}
                columns={[
                  {
                    id: 'column',
                    header: 'Column',
                    rowHeader: true,
                    render: (column) => column.columnNumber,
                  },
                  {
                    id: 'types',
                    header: 'Sample types',
                    render: (column) => column.dataTypes.join(', '),
                  },
                  {
                    id: 'values',
                    header: 'Sample values',
                    render: (column) => column.values.join(' | '),
                  },
                ]}
              />
            </section>
          ))}
        </section>
      )}
      {data.chunks.map((unit) => (
        <details
          key={unit.chunkId}
          id={`source-unit-${String(unit.ordinal)}`}
          open={
            unit.chunkId === selectedUnit ||
            ((selectedUnit === null || selectedUnit === undefined) &&
              ((selectedPage !== null &&
                selectedPage !== undefined &&
                unit.pageNumber === selectedPage) ||
                (selectedSheet !== null &&
                  selectedSheet !== undefined &&
                  unit.location?.sheetName === selectedSheet)))
              ? true
              : undefined
          }
        >
          <summary>
            {unit.pageNumber !== null
              ? `Page ${String(unit.pageNumber)}`
              : (unit.location?.sheetName ??
                `Block ${String((unit.location?.blockIndex ?? unit.ordinal) + 1)}`)}
            {unit.location?.kind === 'HEADING'
              ? ' — heading'
              : unit.location?.kind === 'TABLE'
                ? ' — table'
                : ''}
          </summary>
          <p>
            <a
              href={sourceLocationPath(workspaceId, sourceId, {
                ...unit,
                parserVersion: unit.parserVersion ?? data.parserVersion,
              })}
            >
              Link to this location
            </a>
          </p>
          <p>
            Source: {unit.sourceId}
            {unit.location?.cellRange ? ` · ${unit.location.cellRange}` : ''}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {unit.text || '(No text extracted)'}
          </pre>
        </details>
      ))}
    </Panel>
  );
}
