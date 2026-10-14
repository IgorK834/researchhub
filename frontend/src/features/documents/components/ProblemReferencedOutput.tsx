import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { ProvenancePanel, useOpenProvenance } from '../provenance/ProvenancePanel';
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
  useUiLocale();
  const openProvenance = useOpenProvenance();
  const [open, setOpen] = useState(false);
  const saved = useQuery({
    queryKey: ['solution', workspaceId, reference.analysisId, reference.executionId],
    queryFn: ({ signal }) =>
      fetchSolution(workspaceId, reference.analysisId, reference.executionId, signal),
    retry: false,
  });
  const bundle = saved.data;
  return (
    <section
      className={styles.result}
      aria-label={uiText('ui.ProblemReferencedOutput.message001')}
    >
      {saved.isPending ? (
        <p role="status">{uiText('ui.ProblemReferencedOutput.message002')}</p>
      ) : null}
      {saved.error ? (
        <p role="alert">
          {uiText('ui.ProblemReferencedOutput.message003')} {describeError(saved.error)}
        </p>
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
          <caption>{uiText('ui.ProblemStudio.message025')}</caption>
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
          alt={uiText('ui.ProblemReferencedOutput.message004')}
          src={`/api/workspaces/${encodeURIComponent(workspaceId)}/analyses/${encodeURIComponent(reference.analysisId)}/problem/executions/${encodeURIComponent(reference.executionId)}/artifacts/plot.png`}
        />
      ) : null}
      {caption ? (
        <p>
          {uiText('ui.DocumentAnalysisBlock.message008')} {caption}
        </p>
      ) : null}
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
          {uiText('ui.ProblemReferencedOutput.message005')}
        </Link>
      ) : null}
      <p>{uiText('ui.ProblemReferencedOutput.message006')}</p>
      <Button
        variant="secondary"
        onClick={() => {
          if (openProvenance)
            openProvenance({ kind: 'analysis', workspaceId, reference });
          else setOpen(true);
        }}
      >
        {uiText('ui.Citations.message006')}
      </Button>
      <ProvenancePanel
        target={open ? { kind: 'analysis', workspaceId, reference } : null}
        onClose={() => setOpen(false)}
      />
      {canEdit ? (
        <Button variant="ghost" onClick={onUpdate}>
          {uiText('ui.AnalysisWidgets.message017')}
        </Button>
      ) : null}
    </section>
  );
}
