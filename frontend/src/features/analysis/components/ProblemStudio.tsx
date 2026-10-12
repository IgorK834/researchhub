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
        throw new Error(planned?.missing.join(' ') || 'Complete the problem input');
      return executeProblem(workspaceId, analysisId);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const reproduce = useMutation({
    mutationFn: (id: string) => reproduceProblem(workspaceId, analysisId, id),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  if (analysis.isPending) return <p role="status">Loading problem…</p>;
  if (analysis.error) return <p role="alert">{describeError(analysis.error)}</p>;
  const a = analysis.data;
  const busy =
    run.isPending ||
    reproduce.isPending ||
    executions.data?.some((e) => ['QUEUED', 'RUNNING'].includes(e.status));
  return (
    <section className={styles.result}>
      <Link to={`/app/workspaces/${workspaceId}/analyses`}>All analyses</Link>
      <h1>{a.userPrompt}</h1>
      <p>PROBLEM · {a.status}</p>
      <p>{a.snapshot.problem.statement}</p>
      <h2>Frozen input</h2>
      <ul>
        {a.snapshot.problem.parameters.map((p) => (
          <li key={p.symbol}>
            {p.symbol} = {p.value ?? 'missing'} {p.unit ?? 'unit missing'}
          </li>
        ))}
      </ul>
      <p>Domain: {a.snapshot.problem.domain ?? 'missing'}</p>
      <ul>
        {a.snapshot.problem.assumptions.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {a.parentAnalysisId && (
        <Link to={`/app/workspaces/${workspaceId}/analyses/${a.parentAnalysisId}`}>
          Previous input snapshot
        </Link>
      )}
      {a.missing.length > 0 && (
        <div role="status">
          <h2>Clarification required</h2>
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
            Calculate in sandbox
          </Button>
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => setChange(!change)}
          >
            Change inputs
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
        Input hash: <code>{a.snapshot.inputHash}</code>
      </p>
      <p>Planning template: {a.snapshot.templateId}</p>
      {a.plan && <p>Model plan: {a.plan.summary}</p>}
      {executions.data?.map((e) => (
        <article key={e.id}>
          <h2>Execution {e.status}</h2>
          <p>
            Run {e.id} · Runtime {e.runtimeVersion}
          </p>
          <p>
            Computation: {e.computationStatus ?? e.status} · Verification:{' '}
            {e.verification?.status ?? 'not performed'}
          </p>
          {e.failureCode && <p role="alert">Calculation failed: {e.failureCode}</p>}
          {e.result && (
            <>
              <p>
                Computations checked in a fresh sandbox. This checks arithmetic and the
                declared units; physical assumptions are listed above.
              </p>
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
                    <summary>Saved calculation steps</summary>
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
                        Substitute the frozen parameters shown above into the formula and
                        evaluate in the declared output unit. Computed values:{' '}
                        {o.values.join(', ')} {o.unit}. Each saved step belongs to
                        execution {e.id}.
                      </p>
                    )}
                  </details>
                </div>
              ))}
              {e.result.plot && (
                <>
                  <table>
                    <caption>Saved numeric plot data</caption>
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
                    alt="Computed plot"
                    src={`${problemPath(workspaceId, analysisId)}/problem/executions/${e.id}/artifacts/plot.png`}
                  />
                </>
              )}
            </>
          )}
          <details>
            <summary>Reproduction and verification receipt</summary>
            <p>Input: {e.inputHash}</p>
            <p>Plan: {e.planHash}</p>
            <p>Image: {e.imageId}</p>
            {e.solution ? (
              <>
                <p>Interpretation: {e.solution.interpretation.status}</p>
                <p>Verification version: {e.solution.verificationVersion}</p>
                <pre>{JSON.stringify(e.solution.codeHashes, null, 2)}</pre>
              </>
            ) : null}
            <pre>{JSON.stringify(e.verification, null, 2)}</pre>
          </details>
          {canEdit && e.imageId && (
            <Button disabled={!!busy} onClick={() => reproduce.mutate(e.id)}>
              Reproduce frozen run
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}
