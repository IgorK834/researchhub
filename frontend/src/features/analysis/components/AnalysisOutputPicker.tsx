import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAnalyses, fetchExecutions, fetchExecutionRecord } from '../api/analysisApi';
import { describeError, queryKeys } from '../../../shared/api';
import type { AnalysisReference } from '../../documents/api/analysisReference';
import { Button } from '../../../shared/components/Button';
import { fetchProblemExecutions } from '../api/problemApi';
import { fetchSolution } from '../api/solutionApi';
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
  useUiLocale();
  const [analysisId, setAnalysisId] = useState(initial?.analysisId ?? '');
  const [executionId, setExecutionId] = useState(initial?.executionId ?? '');
  const [outputId, setOutputId] = useState(initial?.outputId ?? '');
  const [offset, setOffset] = useState(0);
  const analyses = useQuery({
    queryKey: [...queryKeys.analyses(workspaceId), { offset }],
    queryFn: ({ signal }) => fetchAnalyses(workspaceId, offset, signal),
  });
  const problem =
    analyses.data?.find((a) => a.id === analysisId)?.workload === 'PROBLEM' ||
    (initial?.analysisId === analysisId && initial.workload === 'PROBLEM');
  const executions = useQuery({
    queryKey: [...queryKeys.executions(workspaceId, analysisId), 'picker', !!problem],
    queryFn: async ({ signal }) =>
      problem
        ? (await fetchProblemExecutions(workspaceId, analysisId, signal)).map((e) => ({
            id: e.id,
            status: e.status,
            attempt: null,
            finishedAt: e.completedAt ?? null,
          }))
        : fetchExecutions(workspaceId, analysisId, signal),
    enabled: !!analysisId,
  });
  const record = useQuery({
    queryKey: [
      ...queryKeys.executionRecord(workspaceId, analysisId, executionId),
      'picker',
      !!problem,
    ],
    queryFn: async ({ signal }) => {
      if (!problem)
        return fetchExecutionRecord(workspaceId, analysisId, executionId, signal);
      const solution = await fetchSolution(workspaceId, analysisId, executionId, signal);
      const outputs: { name: string; kind: 'SOLUTION' | 'TABLE' | 'CHART' }[] = [
        { name: 'solution', kind: 'SOLUTION' },
      ];
      if (solution.plot)
        outputs.push(
          { name: 'plot-data', kind: 'TABLE' },
          { name: 'plot', kind: 'CHART' },
        );
      return { execution: { status: 'SUCCEEDED' as const, result: { outputs } } };
    },
    enabled: !!executionId,
  });
  const error = analyses.error ?? executions.error ?? record.error;
  const output =
    record.data?.execution.status === 'SUCCEEDED'
      ? record.data.execution.result?.outputs.find((output) => output.name === outputId)
      : undefined;
  return (
    <fieldset disabled={disabled} className={styles.picker}>
      <legend>{uiText('ui.AnalysisOutputPicker.message001')}</legend>
      {error ? (
        <p role="alert">
          {uiText('ui.AnalysisOutputPicker.message002')} {describeError(error)}
        </p>
      ) : null}
      <Select
        label={uiText('ui.AnalysisOutputPicker.message003')}
        value={analysisId}
        onChange={(event) => {
          setAnalysisId(event.target.value);
          setExecutionId('');
          setOutputId('');
        }}
      >
        <option value="">{uiText('ui.AnalysisOutputPicker.message004')}</option>
        {analyses.data?.map((analysis) => (
          <option key={analysis.id} value={analysis.id}>
            {analysis.plan?.summary ?? analysis.userPrompt}
          </option>
        ))}
        {initial && !analyses.data?.some((a) => a.id === initial.analysisId) ? (
          <option value={initial.analysisId}>
            {uiText('ui.AnalysisOutputPicker.message005')}{' '}
            {initial.analysisId.slice(0, 8)}
          </option>
        ) : null}
      </Select>
      <div className={styles.pages}>
        <Button
          variant="ghost"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {uiText('ui.AnalysisList.message014')}
        </Button>
        <Button
          variant="ghost"
          disabled={!analyses.data || analyses.data.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          {uiText('ui.AnalysisList.message015')}
        </Button>
      </div>
      <Select
        label={uiText('ui.AnalysisEvidencePicker.message004')}
        value={executionId}
        onChange={(event) => {
          setExecutionId(event.target.value);
          setOutputId('');
        }}
      >
        <option value="">{uiText('ui.AnalysisOutputPicker.message006')}</option>
        {executions.data
          ?.filter((run) => run.status === 'SUCCEEDED')
          .map((run) => (
            <option key={run.id} value={run.id}>
              {run.attempt === null
                ? uiText('ui.AnalysisOutputPicker.message007')
                : uiText('ui.AnalysisOutputPicker.message008', {
                    value0: run.attempt,
                  })}{' '}
              · {new Date(run.finishedAt!).toLocaleString(getIntlLocale())} ·{' '}
              {run.id.slice(0, 8)}
            </option>
          ))}
      </Select>
      <Select
        label={uiText('ui.AnalysisOutputPicker.message009')}
        value={outputId}
        onChange={(event) => setOutputId(event.target.value)}
      >
        <option value="">{uiText('ui.AnalysisOutputPicker.message010')}</option>
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
          {uiText('ui.AnalysisOutputPicker.message011')} {executionId} · {output.name}
          {uiText('ui.AnalysisOutputPicker.message012')}
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
              ...(problem
                ? {
                    schemaVersion: '2.0',
                    workload: 'PROBLEM',
                    stepId: null,
                    conversationId: null,
                  }
                : {}),
            });
        }}
      >
        {uiText('ui.AnalysisOutputPicker.message013')}
      </Button>
    </fieldset>
  );
}
