import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchSolution } from '../../analysis/api/solutionApi';
import { SolutionView, StepDetailsLink } from '../../analysis/components/SolutionView';
import { describeError } from '../../../shared/api';
import type { AnalysisReference } from '../api/analysisReference';
import { Button } from '../../../shared/components/Button';
import styles from './ProblemReferencedOutput.module.css';

export function ProblemReferencedOutput({
  workspaceId,
  reference,
  caption,
  canEdit = false,
  onUpdate,
}: {
  readonly workspaceId: string;
  readonly reference: AnalysisReference;
  readonly caption: string;
  readonly canEdit?: boolean;
  readonly onUpdate?: () => void;
}): ReactElement {
  const saved = useQuery({
    queryKey: ['solution', workspaceId, reference.analysisId, reference.executionId],
    queryFn: ({ signal }) =>
      fetchSolution(workspaceId, reference.analysisId, reference.executionId, signal),
    retry: false,
  });
  const bundle = saved.data;
  return (
    <section className={styles.result} aria-label="Referenced scientific result">
      {saved.isPending ? <p role="status">Loading saved solution…</p> : null}
      {saved.error ? (
        <p role="alert">Could not load saved solution: {describeError(saved.error)}</p>
      ) : null}
      {bundle &&
      ['SOLUTION', 'STEP', 'INPUTS', 'ASSUMPTIONS'].includes(reference.renderMode) ? (
        <SolutionView
          bundle={bundle}
          mode={reference.renderMode as 'SOLUTION' | 'STEP' | 'INPUTS' | 'ASSUMPTIONS'}
          stepId={reference.stepId}
        />
      ) : null}
      {bundle?.plot && reference.renderMode === 'TABLE' ? (
        <table>
          <caption>Saved numeric plot data</caption>
          <thead>
            <tr>
              <th>x ({bundle.plot.xUnit})</th>
              <th>y ({bundle.plot.yUnit})</th>
            </tr>
          </thead>
          <tbody>
            {bundle.plot.points.map((p, i) => (
              <tr key={i}>
                <td>{p[0]}</td>
                <td>{p[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {bundle?.plot && reference.renderMode === 'CHART' ? (
        <img
          alt="Saved computed plot"
          src={`/api/workspaces/${encodeURIComponent(workspaceId)}/analyses/${encodeURIComponent(reference.analysisId)}/problem/executions/${encodeURIComponent(reference.executionId)}/artifacts/plot.png`}
        />
      ) : null}
      {caption ? <p>Human caption (not verified): {caption}</p> : null}
      {bundle ? (
        <StepDetailsLink
          workspaceId={workspaceId}
          bundle={bundle}
          stepId={reference.stepId}
        />
      ) : null}
      {reference.conversationId ? (
        <Link
          to={`/app/workspaces/${workspaceId}/ask?conversation=${encodeURIComponent(reference.conversationId)}`}
        >
          Open originating conversation
        </Link>
      ) : null}
      <p>
        This block keeps its saved execution. Editing prose does not change checked
        values.
      </p>
      {canEdit ? (
        <Button variant="ghost" onClick={onUpdate}>
          Update reference
        </Button>
      ) : null}
    </section>
  );
}
