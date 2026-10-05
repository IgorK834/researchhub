import type { ReactElement } from 'react';
import { Panel } from '../../../shared/components/content';
import { AnalysisResultTable } from './AnalysisWidgets';
import type { ComputedOutput, ExecutionRecord } from '../api/analysisApi';
import { AnalysisChart } from './AnalysisChart';
import styles from './Analysis.module.css';

export function ResultTable({
  output,
  calculatedColumn,
}: {
  readonly output: Extract<ComputedOutput, { kind: 'TABLE' }>;
  readonly calculatedColumn?: number;
}): ReactElement {
  return (
    <AnalysisResultTable
      name={output.name}
      columns={output.columns}
      rows={output.rows}
      calculatedColumn={calculatedColumn}
    />
  );
}
export function AnalysisResult({
  record,
  onDetails,
}: {
  readonly record: ExecutionRecord;
  readonly onDetails: () => void;
}): ReactElement {
  return (
    <div className={styles.stack}>
      {record.charts.map((chart) => (
        <section
          id={`output-${record.execution.result?.outputs.findIndex((o) => o.name === chart.name)}`}
          key={chart.image.id}
          aria-label={chart.title}
        >
          <AnalysisChart
            key={chart.image.id}
            workspaceId={record.execution.workspaceId}
            chart={chart}
            onDetails={onDetails}
          />
        </section>
      ))}
      {record.execution.result?.outputs.map((output) =>
        output.kind === 'TABLE' ? (
          <section
            id={`output-${record.execution.result!.outputs.indexOf(output)}`}
            key={output.name}
            aria-label={output.name}
          >
            <ResultTable key={output.name} output={output} />
          </section>
        ) : output.kind === 'TEXT' ? (
          <section
            id={`output-${record.execution.result!.outputs.indexOf(output)}`}
            key={output.name}
            aria-label={output.name}
          >
            <Panel key={output.name} title={output.name}>
              <p className={styles.preserve}>{output.text}</p>
            </Panel>
          </section>
        ) : null,
      )}
    </div>
  );
}
