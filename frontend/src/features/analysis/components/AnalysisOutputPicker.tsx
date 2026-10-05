import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAnalyses, fetchExecutions, fetchExecutionRecord } from '../api/analysisApi';
import { describeError, queryKeys } from '../../../shared/api';
import type { AnalysisReference } from '../../documents/api/analysisReference';
import { Button } from '../../../shared/components/Button';
import { Select } from '../../../shared/components/forms';
import styles from './AnalysisOutputPicker.module.css';

/** Integration boundary: explicit selection of saved outputs, never a latest-execution substitution. */
export function AnalysisOutputPicker({
  workspaceId,
  initial,
  onChoose,
  disabled = false,
}: {
  readonly workspaceId: string;
  readonly initial?: AnalysisReference;
  readonly onChoose: (reference: AnalysisReference) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const [analysisId, setAnalysisId] = useState(initial?.analysisId ?? '');
  const [executionId, setExecutionId] = useState(initial?.executionId ?? '');
  const [outputId, setOutputId] = useState(initial?.outputId ?? '');
  const [offset, setOffset] = useState(0);
  const analyses = useQuery({
    queryKey: [...queryKeys.analyses(workspaceId), { offset }],
    queryFn: ({ signal }) => fetchAnalyses(workspaceId, offset, signal),
  });
  const executions = useQuery({
    queryKey: queryKeys.executions(workspaceId, analysisId),
    queryFn: ({ signal }) => fetchExecutions(workspaceId, analysisId, signal),
    enabled: !!analysisId,
  });
  const record = useQuery({
    queryKey: queryKeys.executionRecord(workspaceId, analysisId, executionId),
    queryFn: ({ signal }) =>
      fetchExecutionRecord(workspaceId, analysisId, executionId, signal),
    enabled: !!executionId,
  });
  const error = analyses.error ?? executions.error ?? record.error;
  const output =
    record.data?.execution.status === 'SUCCEEDED'
      ? record.data.execution.result?.outputs.find((output) => output.name === outputId)
      : undefined;
  return (
    <fieldset disabled={disabled} className={styles.picker}>
      <legend>Saved analysis output</legend>
      {error ? (
        <p role="alert">Could not load saved outputs: {describeError(error)}</p>
      ) : null}
      <Select
        label="Analysis"
        value={analysisId}
        onChange={(event) => {
          setAnalysisId(event.target.value);
          setExecutionId('');
          setOutputId('');
        }}
      >
        <option value="">Choose analysis</option>
        {analyses.data?.map((analysis) => (
          <option key={analysis.id} value={analysis.id}>
            {analysis.plan?.summary ?? analysis.userPrompt}
          </option>
        ))}
        {initial && !analyses.data?.some((a) => a.id === initial.analysisId) ? (
          <option value={initial.analysisId}>
            Referenced analysis {initial.analysisId.slice(0, 8)}
          </option>
        ) : null}
      </Select>
      <div className={styles.pages}>
        <Button
          variant="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Newer analyses
        </Button>
        <Button
          variant="ghost"
          disabled={!analyses.data || analyses.data.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Older analyses
        </Button>
      </div>
      <Select
        label="Execution"
        value={executionId}
        onChange={(event) => {
          setExecutionId(event.target.value);
          setOutputId('');
        }}
      >
        <option value="">Choose completed execution</option>
        {executions.data
          ?.filter((run) => run.status === 'SUCCEEDED')
          .map((run) => (
            <option key={run.id} value={run.id}>
              Attempt {run.attempt} · {new Date(run.finishedAt!).toLocaleString()} ·{' '}
              {run.id.slice(0, 8)}
            </option>
          ))}
      </Select>
      <Select
        label="Output"
        value={outputId}
        onChange={(event) => setOutputId(event.target.value)}
      >
        <option value="">Choose output</option>
        {record.data?.execution.status === 'SUCCEEDED'
          ? record.data.execution.result?.outputs.map((output) => (
              <option key={output.name} value={output.name}>
                {output.name} ({output.kind})
              </option>
            ))
          : null}
      </Select>
      {output ? (
        <p>
          Reference: {executionId} · {output.name}. It stays on this execution until you
          explicitly update it.
        </p>
      ) : null}
      <Button
        variant="secondary"
        disabled={!output || !!error}
        onClick={() => {
          if (output)
            onChoose({
              analysisId,
              executionId,
              outputId: output.name,
              renderMode: output.kind === 'TEXT' ? 'SUMMARY' : output.kind,
            });
        }}
      >
        Use selected output
      </Button>
    </fieldset>
  );
}
