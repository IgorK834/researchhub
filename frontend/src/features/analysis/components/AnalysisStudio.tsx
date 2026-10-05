import { useState, type ReactElement } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { Banner } from '../../../shared/components/feedback';
import { Panel, DashedNote } from '../../../shared/components/content';
import { ToolShell } from '../../../shared/components/shell';
import { describeError, queryKeys } from '../../../shared/api';
import {
  executeAnalysis,
  planAnalysis,
  rerunAnalysis,
  fetchAnalysisOrigin,
  executionPath,
} from '../api/analysisApi';
import {
  useAnalysisQuery,
  useExecutionsQuery,
  useExecutionRecordQuery,
} from '../api/useAnalyses';
import { AnalysisStatus } from './AnalysisStatus';
import { AnalysisResult } from './AnalysisResult';
import { AnalysisProvenance } from './AnalysisProvenance';
import { AnalysisLineage } from './AnalysisLineage';
import { analysisFailureMessage } from './analysisMessages';
import styles from './Analysis.module.css';
import { InsertAnalysisResult } from './InsertAnalysisResult';
import { AnalysisCodePanel } from './AnalysisWidgets';

export function AnalysisStudio({
  workspaceId,
  analysisId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly canEdit: boolean;
}): ReactElement {
  const analysis = useAnalysisQuery(workspaceId, analysisId);
  const history = useExecutionsQuery(
    workspaceId,
    analysisId,
    analysis.data !== undefined && !analysis.error,
  );
  const [search, setSearch] = useSearchParams();
  const selectedId = search.get('execution') ?? history.data?.at(-1)?.id ?? '';
  const record = useExecutionRecordQuery(workspaceId, analysisId, selectedId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const origin = useQuery({
    queryKey: [...queryKeys.analysis(workspaceId, analysisId), 'origin'],
    queryFn: ({ signal }) => fetchAnalysisOrigin(workspaceId, analysisId, signal),
    enabled: !!analysis.data && !analysis.error && history.data?.length === 0,
  });
  const rerun = useMutation({
    mutationFn: (mode: 'ORIGINAL' | 'LATEST') =>
      rerunAnalysis(workspaceId, analysisId, selectedId, mode),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: queryKeys.analyses(workspaceId) });
      if (result.analysisId === analysisId && result.execution)
        setSearch({ execution: result.execution.id });
      else
        await navigate(
          `/app/workspaces/${workspaceId}/analyses/${result.analysisId}${result.execution ? `?execution=${encodeURIComponent(result.execution.id)}` : ''}`,
        );
    },
  });
  const run = useMutation({
    mutationFn: async () => {
      if (!analysis.data?.plan) await planAnalysis(workspaceId, analysisId);
      return executeAnalysis(workspaceId, analysisId);
    },
    onSuccess: async (execution) => {
      setSearch({ execution: execution.id });
      await client.invalidateQueries({ queryKey: queryKeys.analyses(workspaceId) });
    },
  });
  if (analysis.isPending) return <p role="status">Loading analysis…</p>;
  if (analysis.error)
    return (
      <Banner tone="error" lead="Analysis unavailable">
        {describeError(analysis.error)}
      </Banner>
    );
  const current = analysis.data;
  const canRun =
    canEdit &&
    !['PLANNING', 'QUEUED', 'RUNNING'].includes(current.status) &&
    (current.plan !== null || current.status === 'DRAFT');
  const saved = record.error ? undefined : record.data;
  const plan = saved?.snapshot.plan ?? current.plan;
  const lineage = saved?.snapshot.lineage ?? origin.data;
  const pending = run.isPending || rerun.isPending;
  const canRerun =
    canRun && saved && ['SUCCEEDED', 'FAILED'].includes(saved.execution.status);
  return (
    <ToolShell
      label="Analysis results"
      secondaryLabel="Analysis inputs"
      secondaryWidth={260}
      secondary={
        saved ? (
          <div className={styles.secondary}>
            <h2>Input datasets</h2>
            {saved.snapshot.inputs.map((input) => (
              <Panel key={input.sourceVersionId} title={input.originalFilename}>
                <p>
                  Version {input.versionNumber} · {input.format}
                </p>
                {input.sheets.map((sheet) => (
                  <p key={sheet.name}>
                    {sheet.name}
                    <br />
                    {sheet.columns.map((c) => c.label ?? `Column ${c.index}`).join(', ')}
                  </p>
                ))}
              </Panel>
            ))}
            <div className={styles.request}>
              <h3>Your request</h3>
              <p className={styles.preserve}>{saved.snapshot.userPrompt}</p>
            </div>
            <DashedNote>
              Every attempt keeps its original input versions and code. Newer uploads do
              not change this saved result.
            </DashedNote>
          </div>
        ) : (
          <div className={styles.secondary}>
            <h2>Input datasets</h2>
            {current.inputs.map((input) => (
              <Panel
                key={input.sourceVersionId}
                title={`Source ${input.sourceId.slice(0, 8)}`}
              >
                <p>Version {input.sourceVersionId}</p>
                <p>{input.sheetName ?? 'All selected sheets'}</p>
              </Panel>
            ))}
            <div className={styles.request}>
              <h3>Your request</h3>
              <p className={styles.preserve}>{current.userPrompt}</p>
            </div>
          </div>
        )
      }
      context={saved ? <AnalysisProvenance record={saved} /> : undefined}
      contextTitle="Provenance"
      contextOpen={detailsOpen}
      onContextOpenChange={setDetailsOpen}
    >
      <div className={styles.page}>
        <div className={styles.actions}>
          <Link to={`/app/workspaces/${workspaceId}/analyses`}>All analyses</Link>
          <AnalysisStatus status={saved?.execution.status ?? current.status} />
        </div>
        <h1>
          {saved?.snapshot.plan.summary ?? current.plan?.summary ?? current.userPrompt}
        </h1>
        <div className={styles.actions}>
          {canRun && !selectedId && history.data?.length === 0 ? (
            <Button
              variant="secondary"
              icon="refresh"
              disabled={pending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? 'Queueing…'
                : current.status === 'DRAFT' || current.status === 'READY_TO_EXECUTE'
                  ? 'Run analysis'
                  : 'Re-run same data and code'}
            </Button>
          ) : null}
          {canRerun ? (
            <>
              <Button
                variant="secondary"
                icon="refresh"
                disabled={pending}
                onClick={() => rerun.mutate('ORIGINAL')}
              >
                Re-run with original inputs
              </Button>
              <Button
                variant="secondary"
                icon="refresh"
                disabled={pending}
                onClick={() => rerun.mutate('LATEST')}
              >
                Re-run against latest sources
              </Button>
            </>
          ) : null}
          {plan ? (
            <Button
              variant="secondary"
              icon="code"
              aria-expanded={codeOpen}
              aria-controls="analysis-code"
              onClick={() => setCodeOpen(!codeOpen)}
            >
              {codeOpen ? 'Hide code' : 'Show code'}
            </Button>
          ) : null}
          {saved?.execution.status === 'SUCCEEDED' && canEdit ? (
            <Button variant="secondary" onClick={() => setInsertOpen(true)}>
              Insert into document
            </Button>
          ) : null}
          {saved ? (
            <Button
              variant="secondary"
              icon="layers"
              onClick={() => setDetailsOpen(true)}
            >
              View provenance
            </Button>
          ) : null}
          {history.data?.length ? (
            <label className={styles.historySelect}>
              Run history
              <select
                aria-label="Execution attempt"
                value={selectedId}
                onChange={(event) => setSearch({ execution: event.target.value })}
              >
                {history.data.map((e) => (
                  <option key={e.id} value={e.id}>
                    Attempt {e.attempt} ·{' '}
                    {e.status === 'SUCCEEDED' ? 'Completed' : e.status} ·{' '}
                    {new Date(e.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {canRerun ? (
          <p className={styles.meta}>
            Original inputs reuse the accepted code and saved runtime image when recorded.
            Latest sources create a new analysis and plan after verifying its sheets and
            columns.
          </p>
        ) : null}
        {saved && !saved.execution.provenance.imageId && canRerun ? (
          <Banner tone="warning" lead="Original runtime was not recorded">
            A rerun will use the current pinned server runtime; exact environment
            reproduction cannot be guaranteed.
          </Banner>
        ) : null}
        {lineage ? <AnalysisLineage workspaceId={workspaceId} lineage={lineage} /> : null}
        {saved &&
        ['QUEUED', 'RUNNING'].includes(current.status) &&
        ['SUCCEEDED', 'FAILED'].includes(saved.execution.status) ? (
          <Banner lead="Another attempt is in progress">
            You are viewing a saved historical attempt. Its inputs and results remain
            unchanged.
          </Banner>
        ) : null}
        {origin.error ? (
          <Banner tone="error" lead="Could not load this analysis origin">
            {describeError(origin.error)}
          </Banner>
        ) : null}
        {pending ? (
          <p role="status">
            {rerun.variables === 'LATEST' && rerun.isPending
              ? 'Checking latest versions and preparing a new analysis…'
              : 'Queueing an explicit execution…'}
          </p>
        ) : null}
        {rerun.error ? (
          <Banner tone="error" lead="Could not re-run this analysis">
            {describeError(rerun.error)}
          </Banner>
        ) : null}
        {run.error ? (
          <Banner tone="error" lead="Could not start this attempt">
            {describeError(run.error)}
          </Banner>
        ) : null}
        {!current.plan && current.status === 'FAILED' && history.data?.length === 0 ? (
          <Banner tone="error" lead="The analysis plan could not be completed">
            {analysisFailureMessage(current.failureCode)}{' '}
            <Link to={`/app/workspaces/${workspaceId}/analyses/new`}>
              Create a new analysis
            </Link>
          </Banner>
        ) : null}
        {current.status === 'PLANNING' ? (
          <Banner lead="Preparing the analysis plan">
            The request and selected source versions are saved. Code has not been executed
            yet.
          </Banner>
        ) : null}
        {plan ? (
          <details className={styles.plan}>
            <summary>Analysis plan</summary>
            <p>{plan.summary}</p>
            {[...plan.transformations, ...plan.statisticalOperations].map((step, i) => (
              <p key={i}>
                <strong>{step.name}</strong>: {step.description}
              </p>
            ))}
            <p>
              Planned outputs:{' '}
              {plan.outputs.map((output) => `${output.name} (${output.kind})`).join(', ')}
            </p>
            <h3>Assumptions</h3>
            {plan.assumptions.length ? (
              <ul>
                {plan.assumptions.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            ) : (
              <p>No assumptions recorded.</p>
            )}
          </details>
        ) : null}
        {plan?.warnings.length ? (
          <Banner tone="warning" lead="Analysis warnings">
            <ul>
              {plan.warnings.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </Banner>
        ) : null}
        {history.isPending ? <p role="status">Loading run history…</p> : null}
        {history.error ? (
          <Banner tone="error" lead="Could not load run history">
            {describeError(history.error)}
          </Banner>
        ) : null}
        {selectedId && record.isPending ? (
          <p role="status">Loading saved execution…</p>
        ) : null}
        {record.error ? (
          <Banner tone="error" lead="Saved execution unavailable">
            {describeError(record.error)}
          </Banner>
        ) : null}
        {saved ? (
          <>
            <p className={styles.meta}>
              Viewing attempt {saved.execution.attempt} ·{' '}
              <AnalysisStatus status={saved.execution.status} /> ·{' '}
              {saved.execution.finishedAt
                ? new Date(saved.execution.finishedAt).toLocaleString()
                : 'You can leave this page and return to the saved attempt.'}
            </p>
            {['QUEUED', 'RUNNING'].includes(saved.execution.status) ? (
              <Banner lead="Working on your analysis">
                The result appears here once this attempt finishes.
              </Banner>
            ) : null}
            {saved.execution.status === 'FAILED' ? (
              <Banner tone="error" lead="This attempt could not be completed">
                <p>{analysisFailureMessage(saved.execution.failureCode)}</p>
                <p>Previous successful attempts remain in run history.</p>
              </Banner>
            ) : null}
            <AnalysisResult
              key={saved.execution.id}
              record={saved}
              onDetails={() => setDetailsOpen(true)}
            />
            <p className={styles.meta}>
              <Link
                to={`/app/workspaces/${workspaceId}/analyses/${analysisId}?execution=${encodeURIComponent(saved.execution.id)}`}
              >
                Result permalink
              </Link>{' '}
              ·{' '}
              <a
                href={`${executionPath(workspaceId, analysisId, saved.execution.id)}/provenance`}
                target="_blank"
                rel="noreferrer"
              >
                Provenance API (JSON)
              </a>
            </p>
          </>
        ) : null}
        {plan ? (
          <AnalysisCodePanel
            id="analysis-code"
            code={plan.code.source}
            open={codeOpen}
            onOpenChange={setCodeOpen}
            toggleVisible={false}
            hash={saved?.execution.provenance.codeSha256}
            footer={
              saved ? (
                <a
                  href={`${executionPath(workspaceId, analysisId, saved.execution.id)}/code`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Code API (JSON)
                </a>
              ) : undefined
            }
          />
        ) : null}
        {insertOpen && saved ? (
          <InsertAnalysisResult record={saved} onClose={() => setInsertOpen(false)} />
        ) : null}
        {history.data?.length === 0 ? (
          <Panel title="No executions yet">
            <p>
              {current.plan
                ? 'The accepted plan is saved. Run it to produce a persisted result.'
                : current.status === 'FAILED'
                  ? 'Planning did not produce an accepted plan. Create a new analysis to change the request.'
                  : 'The request and exact source selections are saved.'}
            </p>
          </Panel>
        ) : null}
      </div>
    </ToolShell>
  );
}
