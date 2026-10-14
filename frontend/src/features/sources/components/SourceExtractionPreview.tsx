import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
  if (isPending)
    return <p role="status">{uiText('ui.SourceExtractionPreview.message001')}</p>;
  if (error !== null) {
    return (
      <div>
        <p role="alert">
          {uiText('ui.SourceExtractionPreview.message002')} {describeError(error)}
        </p>
        <Button variant="secondary" type="button" onClick={() => void refetch()}>
          {uiText('ui.SourceExtractionPreview.message003')}
        </Button>
      </div>
    );
  }
  if (data === null) return <p>{uiText('ui.SourceExtractionPreview.message004')}</p>;
  return (
    <Panel title={uiText('ui.SourceExtractionPreview.message005')}>
      {expectedParserVersion && expectedParserVersion !== data.parserVersion ? (
        <p role="alert">{uiText('ui.SourceExtractionPreview.message006')}</p>
      ) : null}
      {selectedUnit && !data.chunks.some((unit) => unit.chunkId === selectedUnit) ? (
        <p role="alert">{uiText('ui.SourceExtractionPreview.message007')}</p>
      ) : null}
      {data.warnings.map((warning, index) => (
        <p role="status" key={index}>
          {warning}
        </p>
      ))}
      {data.workbook === null ? null : (
        <section aria-label={uiText('ui.SourceExtractionPreview.message008')}>
          {data.workbook.csvProfile === undefined ||
          data.workbook.csvProfile === null ? null : (
            <CsvAssetProfile profile={data.workbook.csvProfile} />
          )}
          <h3>{uiText('ui.SourceExtractionPreview.message008')}</h3>
          <p>
            {uiText('ui.SourceExtractionPreview.message009')} {data.workbook.rowLimit}{' '}
            {uiText('ui.SourceExtractionPreview.message010')} {data.workbook.columnLimit}{' '}
            {uiText('ui.SourceExtractionPreview.message011')} {data.workbook.sampleLimit}{' '}
            {uiText('ui.SourceExtractionPreview.message012')}
          </p>
          {data.workbook.sheets.map((sheet) => (
            <section key={sheet.name}>
              <h4>
                {sheet.name} ({sheet.state})
              </h4>
              <p>
                {uiText('ui.SourceExtractionPreview.message013')}{' '}
                {sheet.usedRange ?? uiText('ui.ProblemForm.message012')}
                {uiText('ui.SourceExtractionPreview.message014')}{' '}
                {sheet.rowCountEstimate ?? uiText('ui.ProblemForm.message012')}
                {uiText('ui.SourceExtractionPreview.message015')}{' '}
                {sheet.columnCount ?? uiText('ui.ProblemForm.message012')}.
              </p>
              <p>
                {uiText('ui.SourceExtractionPreview.message016')} {sheet.sampledRows}
                {sheet.truncated
                  ? ' ' + uiText('ui.SourceExtractionPreview.message017')
                  : ''}
                .
              </p>
              <p>
                {uiText('ui.SourceExtractionPreview.message018')}{' '}
                {sheet.formulaPresence === null
                  ? uiText('ui.SourceExtractionPreview.message019')
                  : sheet.formulaPresence
                    ? uiText('ui.SourceExtractionPreview.message020')
                    : uiText('ui.SourceExtractionPreview.message021')}
                {sheet.formulaScanComplete
                  ? ''
                  : ' ' + uiText('ui.SourceExtractionPreview.message022')}
                {uiText('ui.SourceExtractionPreview.message023')}
              </p>
              <p>
                {uiText('ui.SourceExtractionPreview.message024')}
                {sheet.headerRow === null
                  ? ''
                  : ' ' +
                    uiText('ui.SourceExtractionPreview.message025', {
                      value0: String(sheet.headerRow),
                    })}
                :{' '}
                {sheet.headerCandidate.join(' | ') ||
                  uiText('ui.ProvenancePanel.message022')}
              </p>
              <h5>{uiText('ui.SourceExtractionPreview.message026')}</h5>
              {(sheet.previewRows ?? []).length === 0 ? (
                <p>{uiText('ui.SourceExtractionPreview.message027')}</p>
              ) : (
                <DataTable
                  caption={uiText('ui.SourceExtractionPreview.message028', {
                    value0: sheet.name,
                  })}
                  rows={sheet.previewRows}
                  rowKey={(row) => row.rowNumber}
                  columns={[
                    {
                      id: 'row',
                      get header() {
                        return uiText('ui.DatasetPreviewPanel.message056');
                      },
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
                {uiText('ui.SourceExtractionPreview.message029')}{' '}
                {data.workbook?.previewRowLimit ?? 50}{' '}
                {uiText('ui.SourceExtractionPreview.message030')}
              </p>
              <DataTable
                caption={uiText('ui.SourceExtractionPreview.message031', {
                  value0: sheet.name,
                })}
                rows={sheet.columns}
                rowKey={(column) => column.columnNumber}
                columns={[
                  {
                    id: 'column',
                    get header() {
                      return uiText('ui.AnalysisProvenance.message007');
                    },
                    rowHeader: true,
                    render: (column) => column.columnNumber,
                  },
                  {
                    id: 'types',
                    get header() {
                      return uiText('ui.SourceExtractionPreview.message032');
                    },
                    render: (column) => column.dataTypes.join(', '),
                  },
                  {
                    id: 'values',
                    get header() {
                      return uiText('ui.SourceExtractionPreview.message033');
                    },
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
              ? uiText('ui.SourceExtractionPreview.message034', {
                  value0: String(unit.pageNumber),
                })
              : (unit.location?.sheetName ??
                uiText('ui.SourceExtractionPreview.message035', {
                  value0: String((unit.location?.blockIndex ?? unit.ordinal) + 1),
                }))}
            {unit.location?.kind === 'HEADING'
              ? ' ' + uiText('ui.SourceExtractionPreview.message036')
              : unit.location?.kind === 'TABLE'
                ? ' ' + uiText('ui.SourceExtractionPreview.message037')
                : ''}
          </summary>
          <p>
            <a
              href={sourceLocationPath(workspaceId, sourceId, {
                ...unit,
                parserVersion: unit.parserVersion ?? data.parserVersion,
              })}
            >
              {uiText('ui.SourceExtractionPreview.message038')}
            </a>
          </p>
          <p>
            {uiText('ui.DocumentAnalysisBlock.message010')} {unit.sourceId}
            {unit.location?.cellRange ? ` · ${unit.location.cellRange}` : ''}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {unit.text || uiText('ui.SourceExtractionPreview.message039')}
          </pre>
        </details>
      ))}
    </Panel>
  );
}
