import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import { describeError } from '../../../shared/api';
import { fetchSourceExtraction } from '../api/sourceExtraction';

export function SourceExtractionPreview({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['workspaces', workspaceId, 'sources', sourceId, 'extraction'],
    queryFn: ({ signal }) => fetchSourceExtraction(workspaceId, sourceId, signal),
  });
  if (isPending) return <p role="status">Loading extracted content…</p>;
  if (error !== null) {
    return (
      <div>
        <p role="alert">Could not load extracted content: {describeError(error)}</p>
        <button type="button" onClick={() => void refetch()}>
          Retry extraction preview
        </button>
      </div>
    );
  }
  if (data === null) return <p>Extracted content is not available yet.</p>;
  return (
    <section aria-label="Extracted content">
      <h2>Extracted content</h2>
      <p>Parser: {data.parserVersion}</p>
      {data.warnings.map((warning, index) => (
        <p role="status" key={index}>
          {warning}
        </p>
      ))}
      {data.workbook === null ? null : (
        <section aria-label="Workbook metadata">
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
                {sheet.headerRow === null ? '' : ` (row ${String(sheet.headerRow)})`}:{' '}
                {sheet.headerCandidate.join(' | ') || 'None'}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Sample types</th>
                    <th>Sample values</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.columns.map((column) => (
                    <tr key={column.columnNumber}>
                      <td>{column.columnNumber}</td>
                      <td>{column.dataTypes.join(', ')}</td>
                      <td>{column.values.join(' | ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </section>
      )}
      {data.chunks.map((unit) => (
        <details key={unit.chunkId}>
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
            Source: {unit.sourceId}
            {unit.location?.cellRange ? ` · ${unit.location.cellRange}` : ''}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {unit.text || '(No text extracted)'}
          </pre>
        </details>
      ))}
    </section>
  );
}
