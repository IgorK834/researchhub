import { t as uiText, useLocale as useUiLocale } from '../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../shared/components/Button';
import { ResearchHubMark } from '../../shared/components/shell';
import {
  loadOverview,
  loadTrace,
  type Detail,
  type Feature,
  type Overview,
} from './devtoolsApi';
import styles from './AiDebugger.module.css';

const labels: Record<Feature, string> = {
  get ASK_WORKSPACE() {
    return uiText('ui.AiDebugger.message091');
  },
  get SECTION_GENERATION() {
    return uiText('ui.AiDebugger.message092');
  },
  get REWRITE() {
    return uiText('ui.AiDebugger.message093');
  },
  get EVIDENCE_SEARCH() {
    return uiText('ui.AiDebugger.message094');
  },
  get SOURCE_ANALYSIS() {
    return uiText('ui.AiDebugger.message095');
  },
  get ANALYSIS_PLANNING() {
    return uiText('ui.AiDebugger.message096');
  },
  get GROUNDED_RESPONSE() {
    return uiText('ui.AiDebugger.message097');
  },
};
const number = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'Unknown' : value.toLocaleString('en-US');
const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'Unknown' : `$${value.toFixed(6)}`;
const duration = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? uiText('ui.AiDebugger.message001')
    : `${number(value)} ms`;

export function AiDebugger(): ReactElement {
  useUiLocale();
  const { workspaceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState(30);
  const overview = useQuery({
    queryKey: ['ai-diagnostics', workspaceId, days],
    queryFn: ({ signal }) => loadOverview(workspaceId, days, signal),
    retry: false,
    gcTime: 0,
  });
  const id = params.get('trace') ?? overview.data?.traces[0]?.id;
  const detail = useQuery({
    queryKey: ['ai-trace', workspaceId, id],
    queryFn: ({ signal }) => loadTrace(workspaceId, id!, signal),
    enabled: overview.isSuccess && id !== undefined,
    retry: false,
    gcTime: 0,
  });
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link
          to={`/app/workspaces/${encodeURIComponent(workspaceId)}`}
          aria-label={uiText('ui.AiDebugger.message002')}
        >
          <ResearchHubMark />
          <span>ResearchHub</span>
        </Link>
        <span className={styles.divider} />
        <strong>{uiText('ui.AiDebugger.message003')}</strong>
        <span className={styles.staff}>{uiText('ui.AiDebugger.message004')}</span>
        <span className={styles.environment}>{uiText('ui.AiDebugger.message005')}</span>
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <h1>{uiText('ui.AiDebugger.message006')}</h1>
            <p>{uiText('ui.AiDebugger.message007')}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void overview.refetch();
              if (id !== undefined) void detail.refetch();
            }}
          >
            {uiText('ui.AiDebugger.message008')}
          </Button>
        </div>
        {overview.isPending ? (
          <p role="status">{uiText('ui.AiDebugger.message009')}</p>
        ) : overview.isError ? (
          <div className={styles.notice} role="alert">
            <h2>{uiText('ui.AiDebugger.message010')}</h2>
            <p>{uiText('ui.AiDebugger.message011')}</p>
          </div>
        ) : (
          <>
            <UsageOverview overview={overview.data} days={days} setDays={setDays} />
            <section
              className={styles.requests}
              aria-label={uiText('ui.AiDebugger.message012')}
            >
              <label htmlFor="trace">{uiText('ui.AiDebugger.message013')}</label>
              <select
                id="trace"
                value={id ?? ''}
                onChange={(event) => setParams({ trace: event.target.value })}
              >
                {overview.data.traces.map((trace) => (
                  <option key={trace.id} value={trace.id}>
                    {trace.startedAt} · {trace.status} · {trace.correlationId}
                  </option>
                ))}
              </select>
              <span>
                {uiText('ui.AiDebugger.message014')}{' '}
                {overview.data.contentCaptureEnabled
                  ? uiText('ui.AiDebugger.message015')
                  : uiText('ui.AiDebugger.message016')}
              </span>
            </section>
            {overview.data.traces.length === 0 ? (
              <div className={styles.notice}>
                <h2>{uiText('ui.AiDebugger.message017')}</h2>
                <p>{uiText('ui.AiDebugger.message018')}</p>
              </div>
            ) : detail.isPending ? (
              <p role="status">{uiText('ui.AiDebugger.message019')}</p>
            ) : detail.isError ? (
              <p role="alert">{uiText('ui.AiDebugger.message020')}</p>
            ) : detail.data ? (
              <TraceDetail detail={detail.data} workspaceId={workspaceId} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
function UsageOverview({
  overview,
  days,
  setDays,
}: {
  readonly overview: Overview;
  readonly days: number;
  readonly setDays: (days: number) => void;
}): ReactElement {
  useUiLocale();
  return (
    <section className={styles.usage} aria-label={uiText('ui.AiDebugger.message021')}>
      <div className={styles.sectionHeading}>
        <h2>{uiText('ui.AiDebugger.message022')}</h2>
        <label>
          {uiText('ui.AiDebugger.message023')}{' '}
          <select
            aria-label={uiText('ui.WorkspaceGovernance.message003')}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>{uiText('ui.AiDebugger.message024')}</option>
            <option value={30}>{uiText('ui.AiDebugger.message025')}</option>
            <option value={90}>{uiText('ui.AiDebugger.message026')}</option>
          </select>
        </label>
      </div>
      <div className={styles.tableScroll}>
        <table>
          <thead>
            <tr>
              <th>{uiText('ui.AiDebugger.message027')}</th>
              <th>{uiText('ui.AiDebugger.message028')}</th>
              <th>{uiText('ui.AiDebugger.message029')}</th>
              <th>{uiText('ui.WorkspaceGovernance.message012')}</th>
              <th>{uiText('ui.AiDebugger.message030')}</th>
              <th>{uiText('ui.AiDebugger.message031')}</th>
              <th>{uiText('ui.AiDebugger.message032')}</th>
            </tr>
          </thead>
          <tbody>
            {overview.usage.map((row, index) => (
              <tr key={index}>
                <td>
                  <strong>{labels[row.feature]}</strong>
                  <small>{row.templateId}</small>
                </td>
                <td>
                  {row.model ?? uiText('ui.ProblemForm.message012')}
                  <small>
                    {row.provider ?? uiText('ui.ProblemForm.message012')} ·{' '}
                    {row.modelVersion ?? uiText('ui.ProblemForm.message012')}
                  </small>
                </td>
                <td>{row.status}</td>
                <td>{number(row.requests)}</td>
                <td>
                  {number(row.inputTokens)} / {number(row.outputTokens)}
                  <small>
                    {row.usageKnown}/{row.requests} {uiText('ui.AiDebugger.message033')}{' '}
                    {row.estimatedUsageRequests} {uiText('ui.AiDebugger.message034')}
                  </small>
                </td>
                <td>{duration(Math.round(row.averageLatencyMs))}</td>
                <td>
                  {cost(row.estimatedCostUsd)}
                  <small>
                    {row.costKnown}/{row.requests} {uiText('ui.AiDebugger.message035')}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overview.usage.length === 0 ? <p>{uiText('ui.AiDebugger.message036')}</p> : null}
      <p className={styles.disclaimer}>{uiText('ui.AiDebugger.message037')}</p>
    </section>
  );
}
function TraceDetail({
  detail,
  workspaceId,
}: {
  readonly detail: Detail;
  readonly workspaceId: string;
}): ReactElement {
  useUiLocale();
  const { trace, usage, chunks } = detail;
  const response = trace.response;
  const claims = response?.generation?.result.answer.claims ?? [];
  return (
    <>
      <div className={styles.requestBar}>
        <code title={trace.correlationId}>
          {uiText('ui.AiDebugger.message038')} {trace.correlationId}
        </code>
        <span className={styles.status} data-status={trace.status}>
          {trace.status}
        </span>
        <time>{trace.startedAt}</time>
      </div>
      <div className={styles.columns}>
        <section className={styles.card} aria-label={uiText('ui.AiDebugger.message039')}>
          <h2>{uiText('ui.AiDebugger.message040')}</h2>
          <p className={styles.query}>
            {trace.query ?? uiText('ui.AiDebugger.message041')}
          </p>
          <dl>
            <dt>{uiText('ui.AiDebugger.message042')}</dt>
            <dd>{trace.id}</dd>
            <dt>{uiText('ui.AiDebugger.message043')}</dt>
            <dd>{trace.generationRequestId ?? uiText('ui.AiDebugger.message001')}</dd>
            <dt>{uiText('ui.landingContent.message001')}</dt>
            <dd>{trace.workspaceId}</dd>
            <dt>{uiText('ui.AiDebugger.message044')}</dt>
            <dd>
              {trace.selectedSourceIds === null
                ? uiText('ui.AiDebugger.message045')
                : trace.selectedSourceIds.length === 0
                  ? uiText('ui.ResearchPanel.message032')
                  : trace.selectedSourceIds.join(', ')}
            </dd>
            <dt>{uiText('ui.AiDebugger.message046')}</dt>
            <dd>{trace.selectedAnalysisOutputs.length}</dd>
            <dt>{uiText('ui.AiDebugger.message047')}</dt>
            <dd>
              {uiText('ui.AiDebugger.message048')}
              {trace.topK}
            </dd>
            <dt>{uiText('ui.AiDebugger.message049')}</dt>
            <dd>{uiText('ui.AiDebugger.message050')}</dd>
            <dt>{uiText('ui.AiDebugger.message051')}</dt>
            <dd>
              {usage?.model
                ? `${usage.model.provider} / ${usage.model.name} / ${usage.model.version}`
                : uiText('ui.ProblemForm.message012')}
            </dd>
            <dt>{uiText('ui.AiDebugger.message052')}</dt>
            <dd>{trace.templateId}</dd>
            <dt>{uiText('ui.AiDebugger.message053')}</dt>
            <dd>{trace.templateHash}</dd>
            <dt>{uiText('ui.AiDebugger.message054')}</dt>
            <dd>{trace.parameters.temperature ?? uiText('ui.AiDebugger.message055')}</dd>
            <dt>{uiText('ui.AiDebugger.message056')}</dt>
            <dd>{number(trace.parameters.maxOutputTokens)}</dd>
            <dt>{uiText('ui.AiDebugger.message057')}</dt>
            <dd>{duration(trace.retrievalLatencyMs)}</dd>
            <dt>{uiText('ui.AiDebugger.message058')}</dt>
            <dd>{duration(usage?.latencyMs)}</dd>
            <dt>{uiText('ui.AiDebugger.message030')}</dt>
            <dd>
              {number(usage?.usage?.inputTokens)} / {number(usage?.usage?.outputTokens)}
              {usage?.usage?.estimated ? ' ' + uiText('ui.AiDebugger.message059') : ''}
            </dd>
            <dt>{uiText('ui.AiDebugger.message060')}</dt>
            <dd>
              {cost(usage?.cost?.usd)}
              <small>
                {usage?.cost
                  ? uiText('ui.AiDebugger.message061', {
                      value0: usage.cost.pricingVersion,
                    })
                  : uiText('ui.AiDebugger.message062')}
              </small>
            </dd>
          </dl>
          {trace.errorCode ? (
            <p className={styles.failure} role="alert">
              {trace.errorCode}
              {uiText('ui.AiDebugger.message063')}
            </p>
          ) : null}
        </section>
        <section className={styles.card} aria-label={uiText('ui.AiDebugger.message064')}>
          <div className={styles.sectionHeading}>
            <h2>{uiText('ui.AiDebugger.message064')}</h2>
            <span>
              {chunks.length} {uiText('ui.AiDebugger.message065')}
            </span>
          </div>
          <p className={styles.disclaimer}>{uiText('ui.AiDebugger.message066')}</p>
          {chunks.length === 0 ? (
            <p>{uiText('ui.AiDebugger.message067')}</p>
          ) : (
            <div className={styles.chunkList}>
              {chunks.map((chunk, index) => {
                const citation = chunk.hit.citation;
                const title =
                  response?.generation?.evidence.find(
                    (item) => item.chunkId === citation.chunkId,
                  )?.title ??
                  citation.sectionTitle ??
                  uiText('ui.AiDraftBlock.message007');
                return (
                  <article key={citation.chunkId} className={styles.chunk}>
                    <div className={styles.chunkHeading}>
                      <span className={styles.rank}>#{index + 1}</span>
                      <Link
                        to={`/app/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(citation.sourceId)}`}
                      >
                        {title}
                      </Link>
                      <span className={styles.contextChip}>
                        {chunk.citationKey
                          ? uiText('ui.AiDebugger.message068', {
                              value0: chunk.citationKey,
                            })
                          : uiText('ui.AiDebugger.message069')}
                      </span>
                    </div>
                    <p className={styles.snippet}>
                      {chunk.text ??
                        (chunk.availability === 'SOURCE_UNAVAILABLE'
                          ? uiText('ui.AiDebugger.message070')
                          : uiText('ui.AiDebugger.message071'))}
                    </p>
                    <dl className={styles.chunkStats}>
                      <dt>{uiText('ui.AiDebugger.message072')}</dt>
                      <dd>{chunk.hit.score.toFixed(4)}</dd>
                      <dt>{uiText('ui.AiDebugger.message073')}</dt>
                      <dd>{chunk.hit.vectorSimilarity.toFixed(4)}</dd>
                      <dt>{uiText('ui.AiDebugger.message074')}</dt>
                      <dd>{chunk.hit.lexicalScore.toFixed(4)}</dd>
                      <dt>{uiText('ui.AiDebugger.message075')}</dt>
                      <dd>{number(chunk.hit.contentBytes)}</dd>
                    </dl>
                    <small>
                      {uiText('ui.ExternalSources.message039')}{' '}
                      {citation.pageStart ?? 'n/a'}
                      {citation.pageEnd !== citation.pageStart
                        ? `–${citation.pageEnd}`
                        : ''}{' '}
                      · {citation.processingVersion}
                      {chunk.textReference
                        ? uiText('ui.AiDebugger.message076', {
                            value0: chunk.textReference,
                          })
                        : ''}
                    </small>
                    <code className={styles.chunkId}>{citation.chunkId}</code>
                    <small>
                      {uiText('ui.AiDraftBlock.message007')} {citation.sourceId}{' '}
                      {uiText('ui.CanvasDatasetPicker.message001')}{' '}
                      {citation.sourceVersionId ?? uiText('ui.AiDebugger.message077')}
                    </small>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className={styles.right}>
          <section
            className={styles.card}
            aria-label={uiText('ui.AiDebugger.message078')}
          >
            <h2>{uiText('ui.AiDebugger.message078')}</h2>
            <div className={styles.contextNumber}>
              {number(trace.context?.tokenUpperBound)}
              <small>{uiText('ui.AiDebugger.message079')}</small>
            </div>
            <dl>
              <dt>{uiText('ui.AiDebugger.message080')}</dt>
              <dd>{number(trace.context?.contextBytes)}</dd>
              <dt>{uiText('ui.AiDebugger.message081')}</dt>
              <dd>{number(trace.context?.budget.maxTokens)}</dd>
              <dt>{uiText('ui.AiDebugger.message082')}</dt>
              <dd>{number(trace.context?.budget.maxBytes)}</dd>
              <dt>{uiText('ui.AiDebugger.message083')}</dt>
              <dd>
                {trace.context?.builderVersion ?? uiText('ui.AiDebugger.message001')}
              </dd>
              <dt>{uiText('ui.AiDebugger.message084')}</dt>
              <dd>{trace.context?.tokenPolicy ?? uiText('ui.AiDebugger.message001')}</dd>
            </dl>
            <p className={styles.disclaimer}>{uiText('ui.AiDebugger.message085')}</p>
          </section>
          <section
            className={styles.card}
            aria-label={uiText('ui.AiDebugger.message086')}
          >
            <h2>{uiText('ui.AiDebugger.message087')}</h2>
            {response === null ? (
              <p>
                {trace.errorCode
                  ? uiText('ui.AiDebugger.message088')
                  : uiText('ui.AiDebugger.message089')}
              </p>
            ) : (
              <>
                <span className={styles.status}>{response.status}</span>
                {response.reason ? (
                  <p className={styles.failure}>{response.reason}</p>
                ) : null}
                {claims.length === 0 ? (
                  <p>{response.answer}</p>
                ) : (
                  claims.map((claim, index) => (
                    <div key={index} className={styles.claim}>
                      <p>{claim.text}</p>
                      <div>
                        {claim.evidenceIds.map((id) => (
                          <code key={id}>
                            {trace.context?.citations.find(
                              (binding) => binding.chunkId === id,
                            )?.citationKey ?? id}
                          </code>
                        ))}
                      </div>
                    </div>
                  ))
                )}
                <details>
                  <summary>
                    {uiText('ui.AiDebugger.message090')}
                    {response.citations.length +
                      (response.analysisCitations?.length ?? 0)}
                    )
                  </summary>
                  <pre>
                    {JSON.stringify(
                      {
                        sources: response.citations,
                        analyses: response.analysisCitations ?? [],
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
