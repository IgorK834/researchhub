import { InputFreshness } from './InputFreshness';
import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { ProblemStudio } from './ProblemStudio';
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

function DatasetStudio({
  workspaceId,
  analysisId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly canEdit: boolean;
}): ReactElement {
  useUiLocale();
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
  if (analysis.isPending)
    return <p role="status">{uiText('ui.AnalysisStudio.message001')}</p>;
  if (analysis.error)
    return (
      <Banner tone="error" lead={uiText('ui.AnalysisStudio.message046')}>
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
      label={uiText('ui.AnalysisStudio.message002')}
      secondaryLabel={uiText('ui.AnalysisStudio.message047')}
      secondaryWidth={260}
      secondary={
        saved ? (
          <div className={styles.secondary}>
            <h2>{uiText('ui.AnalysisStudio.message003')}</h2>
            {saved.snapshot.inputs.map((input) => (
              <Panel key={input.sourceVersionId} title={input.originalFilename}>
                <p>
                  {uiText('ui.AnalysisStudio.message004')} {input.versionNumber} ·{' '}
                  {input.format}
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
              <h3>{uiText('ui.AnalysisStudio.message005')}</h3>
              <p className={styles.preserve}>{saved.snapshot.userPrompt}</p>
            </div>
            <DashedNote>{uiText('ui.AnalysisStudio.message006')}</DashedNote>
          </div>
        ) : (
          <div className={styles.secondary}>
            <h2>{uiText('ui.AnalysisStudio.message003')}</h2>
            {current.inputs.map((input) => (
              <Panel
                key={input.sourceVersionId}
                title={uiText('ui.AnalysisStudio.message007', {
                  value0: input.sourceId.slice(0, 8),
                })}
              >
                <p>
                  {uiText('ui.AnalysisStudio.message004')} {input.sourceVersionId}
                </p>
                <p>{input.sheetName ?? uiText('ui.AnalysisStudio.message008')}</p>
              </Panel>
            ))}
            <div className={styles.request}>
              <h3>{uiText('ui.AnalysisStudio.message005')}</h3>
              <p className={styles.preserve}>{current.userPrompt}</p>
            </div>
          </div>
        )
      }
      context={saved ? <AnalysisProvenance record={saved} /> : undefined}
      contextTitle={uiText('ui.DocumentProvenance.message002')}
      contextOpen={detailsOpen}
      onContextOpenChange={setDetailsOpen}
    >
      <div className={styles.page}>
        <div className={styles.actions}>
          <Link to={`/app/workspaces/${workspaceId}/analyses`}>
            {uiText('ui.AnalysisStudio.message009')}
          </Link>
          <AnalysisStatus status={saved?.execution.status ?? current.status} />
        </div>
        <h1>
          {saved?.snapshot.plan.summary ?? current.plan?.summary ?? current.userPrompt}
        </h1>
        <InputFreshness staleness={current.staleness} />
        <div className={styles.actions}>
          {canRun && !selectedId && history.data?.length === 0 ? (
            <Button
              variant="secondary"
              icon="refresh"
              disabled={pending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? uiText('ui.AnalysisStudio.message010')
                : current.status === 'DRAFT' || current.status === 'READY_TO_EXECUTE'
                  ? uiText('ui.AnalysisStudio.message011')
                  : uiText('ui.AnalysisStudio.message012')}
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
                {uiText('ui.AnalysisStudio.message013')}
              </Button>
              <Button
                variant="secondary"
                icon="refresh"
                disabled={pending}
                onClick={() => rerun.mutate('LATEST')}
              >
                {uiText('ui.AnalysisStudio.message014')}
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
              {codeOpen
                ? uiText('ui.AnalysisStudio.message015')
                : uiText('ui.AnalysisStudio.message016')}
            </Button>
          ) : null}
          {saved?.execution.status === 'SUCCEEDED' && canEdit ? (
            <Button variant="secondary" onClick={() => setInsertOpen(true)}>
              {uiText('ui.AnalysisStudio.message017')}
            </Button>
          ) : null}
          {saved ? (
            <Button
              variant="secondary"
              icon="layers"
              onClick={() => setDetailsOpen(true)}
            >
              {uiText('ui.AnalysisStudio.message018')}
            </Button>
          ) : null}
          {history.data?.length ? (
            <label className={styles.historySelect}>
              {uiText('ui.AnalysisStudio.message019')}
              <select
                aria-label={uiText('ui.AnalysisStudio.message020')}
                value={selectedId}
                onChange={(event) => setSearch({ execution: event.target.value })}
              >
                {history.data.map((e) => (
                  <option key={e.id} value={e.id}>
                    {uiText('ui.AnalysisStudio.message021')} {e.attempt} ·{' '}
                    {e.status === 'SUCCEEDED'
                      ? uiText('ui.AnalysisStatus.message006')
                      : e.status}{' '}
                    · {new Date(e.createdAt).toLocaleString(getIntlLocale())}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {canRerun ? (
          <p className={styles.meta}>{uiText('ui.AnalysisStudio.message022')}</p>
        ) : null}
        {saved && !saved.execution.provenance.imageId && canRerun ? (
          <Banner tone="warning" lead={uiText('ui.AnalysisStudio.message048')}>
            {uiText('ui.AnalysisStudio.message023')}
          </Banner>
        ) : null}
        {lineage ? <AnalysisLineage workspaceId={workspaceId} lineage={lineage} /> : null}
        {saved &&
        ['QUEUED', 'RUNNING'].includes(current.status) &&
        ['SUCCEEDED', 'FAILED'].includes(saved.execution.status) ? (
          <Banner lead={uiText('ui.AnalysisStudio.message049')}>
            {uiText('ui.AnalysisStudio.message024')}
          </Banner>
        ) : null}
        {origin.error ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message050')}>
            {describeError(origin.error)}
          </Banner>
        ) : null}
        {pending ? (
          <p role="status">
            {rerun.variables === 'LATEST' && rerun.isPending
              ? uiText('ui.AnalysisStudio.message025')
              : uiText('ui.AnalysisStudio.message026')}
          </p>
        ) : null}
        {rerun.error ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message051')}>
            {describeError(rerun.error)}
          </Banner>
        ) : null}
        {run.error ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message052')}>
            {describeError(run.error)}
          </Banner>
        ) : null}
        {!current.plan && current.status === 'FAILED' && history.data?.length === 0 ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message053')}>
            {analysisFailureMessage(current.failureCode)}{' '}
            <Link to={`/app/workspaces/${workspaceId}/analyses/new`}>
              {uiText('ui.AnalysisStudio.message027')}
            </Link>
          </Banner>
        ) : null}
        {current.status === 'PLANNING' ? (
          <Banner lead={uiText('ui.AnalysisStudio.message054')}>
            {uiText('ui.AnalysisStudio.message028')}
          </Banner>
        ) : null}
        {plan ? (
          <details className={styles.plan}>
            <summary>{uiText('ui.AnalysisStudio.message029')}</summary>
            <p>{plan.summary}</p>
            {[...plan.transformations, ...plan.statisticalOperations].map((step, i) => (
              <p key={i}>
                <strong>{step.name}</strong>: {step.description}
              </p>
            ))}
            <p>
              {uiText('ui.AnalysisStudio.message030')}{' '}
              {plan.outputs.map((output) => `${output.name} (${output.kind})`).join(', ')}
            </p>
            <h3>{uiText('ui.AnalysisStudio.message031')}</h3>
            {plan.assumptions.length ? (
              <ul>
                {plan.assumptions.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            ) : (
              <p>{uiText('ui.AnalysisStudio.message032')}</p>
            )}
          </details>
        ) : null}
        {plan?.warnings.length ? (
          <Banner tone="warning" lead={uiText('ui.AnalysisStudio.message055')}>
            <ul>
              {plan.warnings.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </Banner>
        ) : null}
        {history.isPending ? (
          <p role="status">{uiText('ui.AnalysisStudio.message033')}</p>
        ) : null}
        {history.error ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message056')}>
            {describeError(history.error)}
          </Banner>
        ) : null}
        {selectedId && record.isPending ? (
          <p role="status">{uiText('ui.AnalysisStudio.message034')}</p>
        ) : null}
        {record.error ? (
          <Banner tone="error" lead={uiText('ui.AnalysisStudio.message057')}>
            {describeError(record.error)}
          </Banner>
        ) : null}
        {saved ? (
          <>
            <p className={styles.meta}>
              {uiText('ui.AnalysisStudio.message035')} {saved.execution.attempt} ·{' '}
              <AnalysisStatus status={saved.execution.status} /> ·{' '}
              {saved.execution.finishedAt
                ? new Date(saved.execution.finishedAt).toLocaleString(getIntlLocale())
                : uiText('ui.AnalysisStudio.message036')}
            </p>
            {['QUEUED', 'RUNNING'].includes(saved.execution.status) ? (
              <Banner lead={uiText('ui.AnalysisStudio.message058')}>
                {uiText('ui.AnalysisStudio.message037')}
              </Banner>
            ) : null}
            {saved.execution.status === 'FAILED' ? (
              <Banner tone="error" lead={uiText('ui.AnalysisStudio.message059')}>
                <p>{analysisFailureMessage(saved.execution.failureCode)}</p>
                <p>{uiText('ui.AnalysisStudio.message038')}</p>
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
                {uiText('ui.AnalysisStudio.message039')}
              </Link>{' '}
              ·{' '}
              <a
                href={`${executionPath(workspaceId, analysisId, saved.execution.id)}/provenance`}
                target="_blank"
                rel="noreferrer"
              >
                {uiText('ui.AnalysisStudio.message040')}
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
                  {uiText('ui.AnalysisStudio.message041')}
                </a>
              ) : undefined
            }
          />
        ) : null}
        {insertOpen && saved ? (
          <InsertAnalysisResult record={saved} onClose={() => setInsertOpen(false)} />
        ) : null}
        {history.data?.length === 0 ? (
          <Panel title={uiText('ui.AnalysisStudio.message042')}>
            <p>
              {current.plan
                ? uiText('ui.AnalysisStudio.message043')
                : current.status === 'FAILED'
                  ? uiText('ui.AnalysisStudio.message044')
                  : uiText('ui.AnalysisStudio.message045')}
            </p>
          </Panel>
        ) : null}
      </div>
    </ToolShell>
  );
}

export function AnalysisStudio(props: {
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly canEdit: boolean;
}): ReactElement {
  const analysis = useAnalysisQuery(props.workspaceId, props.analysisId);
  return analysis.data?.workload === 'PROBLEM' ? (
    <ProblemStudio {...props} />
  ) : (
    <DatasetStudio {...props} />
  );
}
