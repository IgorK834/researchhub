import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import styles from './Problem.module.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, type ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { describeError } from '../../../shared/api';
import {
  fetchProblem,
  fetchProblemExecutions,
  planProblem,
  executeProblem,
  reproduceProblem,
  problemPath,
} from '../api/problemApi';
import { ProblemForm } from './ProblemForm';
import { mathValue } from '../../documents/api/mathAst';
import { renderMath } from '../../documents/api/mathExtension';
import { SolutionView } from './SolutionView';
export function ProblemStudio({
  workspaceId,
  analysisId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly canEdit: boolean;
}): ReactElement {
  useUiLocale();
  const client = useQueryClient();
  const key = ['problem', workspaceId, analysisId];
  const analysis = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchProblem(workspaceId, analysisId, signal),
  });
  const executions = useQuery({
    queryKey: [...key, 'executions'],
    queryFn: ({ signal }) => fetchProblemExecutions(workspaceId, analysisId, signal),
    enabled: !!analysis.data,
    refetchInterval: (query) =>
      query.state.data?.some((e) => ['QUEUED', 'RUNNING'].includes(e.status))
        ? 1000
        : false,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const [change, setChange] = useState(false);
  const run = useMutation({
    mutationFn: async () => {
      const planned = analysis.data?.plan
        ? analysis.data
        : await planProblem(workspaceId, analysisId);
      if (planned?.status !== 'READY_TO_EXECUTE')
        throw new Error(
          planned?.missing.join(' ') || uiText('ui.ProblemStudio.message001'),
        );
      return executeProblem(workspaceId, analysisId);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const reproduce = useMutation({
    mutationFn: (id: string) => reproduceProblem(workspaceId, analysisId, id),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  if (analysis.isPending)
    return <p role="status">{uiText('ui.ProblemStudio.message002')}</p>;
  if (analysis.error) return <p role="alert">{describeError(analysis.error)}</p>;
  const a = analysis.data;
  const busy =
    run.isPending ||
    reproduce.isPending ||
    executions.data?.some((e) => ['QUEUED', 'RUNNING'].includes(e.status));
  return (
    <section className={styles.result}>
      <Link to={`/app/workspaces/${workspaceId}/analyses`}>
        {uiText('ui.AnalysisStudio.message009')}
      </Link>
      <h1>{a.userPrompt}</h1>
      <p>
        {uiText('ui.ProblemStudio.message003')} {a.status}
      </p>
      <p>{a.snapshot.problem.statement}</p>
      <h2>{uiText('ui.ProblemStudio.message004')}</h2>
      <ul>
        {a.snapshot.problem.parameters.map((p) => (
          <li key={p.symbol}>
            {p.symbol} = {p.value ?? uiText('ui.ProblemStudio.message005')}{' '}
            {p.unit ?? uiText('ui.ProblemStudio.message006')}
          </li>
        ))}
      </ul>
      <p>
        {uiText('ui.ProblemStudio.message007')}{' '}
        {a.snapshot.problem.domain ?? uiText('ui.ProblemStudio.message005')}
      </p>
      <ul>
        {a.snapshot.problem.assumptions.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {a.parentAnalysisId && (
        <Link to={`/app/workspaces/${workspaceId}/analyses/${a.parentAnalysisId}`}>
          {uiText('ui.ProblemStudio.message008')}
        </Link>
      )}
      {a.missing.length > 0 && (
        <div role="status">
          <h2>{uiText('ui.ProblemStudio.message009')}</h2>
          <ul>
            {a.missing.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && (
        <>
          <Button
            disabled={!!busy || a.missing.length > 0 || a.status === 'FAILED'}
            onClick={() => run.mutate()}
          >
            {uiText('ui.ProblemStudio.message010')}
          </Button>
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => setChange(!change)}
          >
            {uiText('ui.ProblemStudio.message011')}
          </Button>
        </>
      )}
      {change && (
        <ProblemForm
          workspaceId={workspaceId}
          parent={a}
          onCreated={(id) => {
            void navigate(`/app/workspaces/${workspaceId}/analyses/${id}`);
            setChange(false);
          }}
        />
      )}
      {(run.error || reproduce.error || executions.error) && (
        <p role="alert">
          {describeError(run.error || reproduce.error || executions.error)}
        </p>
      )}
      <p>
        {uiText('ui.ProblemStudio.message012')} <code>{a.snapshot.inputHash}</code>
      </p>
      <p>
        {uiText('ui.ProblemStudio.message013')} {a.snapshot.templateId}
      </p>
      {a.plan && (
        <p>
          {uiText('ui.ProblemStudio.message014')} {a.plan.summary}
        </p>
      )}
      {executions.data?.map((e) => (
        <article key={e.id}>
          <h2>
            {uiText('ui.AnalysisEvidencePicker.message004')} {e.status}
          </h2>
          <p>
            {uiText('ui.ProblemStudio.message015')} {e.id}{' '}
            {uiText('ui.ProblemStudio.message016')} {e.runtimeVersion}
          </p>
          <p>
            {uiText('ui.ProblemStudio.message017')} {e.computationStatus ?? e.status}{' '}
            {uiText('ui.ProblemStudio.message018')}{' '}
            {e.verification?.status ?? uiText('ui.ProblemStudio.message019')}
          </p>
          {e.failureCode && (
            <p role="alert">
              {uiText('ui.ProblemStudio.message020')} {e.failureCode}
            </p>
          )}
          {e.result && (
            <>
              <p>{uiText('ui.ProblemStudio.message021')}</p>
              {e.result.outputs.map((o) => (
                <div key={o.name}>
                  <div
                    ref={(el) => {
                      if (el) renderMath(el, mathValue(o.expression), true);
                    }}
                  />
                  <p>
                    {o.name}: {o.values.join(', ')} {o.unit}
                  </p>
                  <details
                    open={e.solution?.steps.some(
                      (s) => location.hash === `#step-${s.id}`,
                    )}
                  >
                    <summary>{uiText('ui.ProblemStudio.message022')}</summary>
                    {e.solution ? (
                      e.solution.steps
                        .filter((s) => s.outputId === o.name)
                        .map((s) => (
                          <SolutionView
                            key={s.id}
                            bundle={e.solution!}
                            mode="STEP"
                            stepId={s.id}
                          />
                        ))
                    ) : (
                      <p>
                        {uiText('ui.ProblemStudio.message023')} {o.values.join(', ')}{' '}
                        {o.unit}
                        {uiText('ui.ProblemStudio.message024')} {e.id}.
                      </p>
                    )}
                  </details>
                </div>
              ))}
              {e.result.plot && (
                <>
                  <table>
                    <caption>{uiText('ui.ProblemStudio.message025')}</caption>
                    <thead>
                      <tr>
                        <th>x ({e.result.plot.xUnit})</th>
                        <th>y ({e.result.plot.yUnit})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.result.plot.points.map((p, i) => (
                        <tr key={i}>
                          <td>{p[0]}</td>
                          <td>{p[1]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <img
                    alt={uiText('ui.ProblemStudio.message026')}
                    src={`${problemPath(workspaceId, analysisId)}/problem/executions/${e.id}/artifacts/plot.png`}
                  />
                </>
              )}
            </>
          )}
          <details>
            <summary>{uiText('ui.ProblemStudio.message027')}</summary>
            <p>
              {uiText('ui.ProblemStudio.message028')} {e.inputHash}
            </p>
            <p>
              {uiText('ui.ProblemStudio.message029')} {e.planHash}
            </p>
            <p>
              {uiText('ui.ProblemStudio.message030')} {e.imageId}
            </p>
            {e.solution ? (
              <>
                <p>
                  {uiText('ui.ProblemStudio.message031')}{' '}
                  {e.solution.interpretation.status}
                </p>
                <p>
                  {uiText('ui.ProblemStudio.message032')} {e.solution.verificationVersion}
                </p>
                <pre>{JSON.stringify(e.solution.codeHashes, null, 2)}</pre>
              </>
            ) : null}
            <pre>{JSON.stringify(e.verification, null, 2)}</pre>
          </details>
          {canEdit && e.imageId && (
            <Button disabled={!!busy} onClick={() => reproduce.mutate(e.id)}>
              {uiText('ui.ProblemStudio.message033')}
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
