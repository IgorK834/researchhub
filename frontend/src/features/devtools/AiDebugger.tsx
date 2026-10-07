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
  ASK_WORKSPACE: 'Ask Workspace',
  SECTION_GENERATION: 'Section generation',
  REWRITE: 'Rewrite',
  EVIDENCE_SEARCH: 'Evidence search',
  SOURCE_ANALYSIS: 'Source analysis',
  ANALYSIS_PLANNING: 'Analysis planning',
  GROUNDED_RESPONSE: 'Grounded response',
};
const number = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'Unknown' : value.toLocaleString('en-US');
const cost = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'Unknown' : `$${value.toFixed(6)}`;
const duration = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'Not run' : `${number(value)} ms`;

export function AiDebugger(): ReactElement {
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
          aria-label="Back to workspace"
        >
          <ResearchHubMark />
          <span>ResearchHub</span>
        </Link>
        <span className={styles.divider} />
        <strong>AI debugger</strong>
        <span className={styles.staff}>INTERNAL · STAFF ONLY</span>
        <span className={styles.environment}>Protected workspace diagnostics</span>
      </header>
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <h1>Inside the answer</h1>
            <p>Inspect retrieval, context and model usage in one place.</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              void overview.refetch();
              if (id !== undefined) void detail.refetch();
            }}
          >
            Refresh
          </Button>
        </div>
        {overview.isPending ? (
          <p role="status">Loading protected diagnostics…</p>
        ) : overview.isError ? (
          <div className={styles.notice} role="alert">
            <h2>Diagnostics unavailable</h2>
            <p>
              This tool requires an enabled deployment, an operator account and access to
              this workspace.
            </p>
          </div>
        ) : (
          <>
            <UsageOverview overview={overview.data} days={days} setDays={setDays} />
            <section className={styles.requests} aria-label="RAG requests">
              <label htmlFor="trace">RAG request</label>
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
                Latest 50 ·{' '}
                {overview.data.contentCaptureEnabled
                  ? 'Content capture enabled for operator requests'
                  : 'Private content capture disabled'}
              </span>
            </section>
            {overview.data.traces.length === 0 ? (
              <div className={styles.notice}>
                <h2>No RAG requests yet</h2>
                <p>
                  Ask a question in this workspace, then refresh to inspect its trace.
                </p>
              </div>
            ) : detail.isPending ? (
              <p role="status">Loading request…</p>
            ) : detail.isError ? (
              <p role="alert">
                This request is unavailable. Refresh or select another request.
              </p>
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
  return (
    <section className={styles.usage} aria-label="Aggregate AI usage">
      <div className={styles.sectionHeading}>
        <h2>Usage by feature & model</h2>
        <label>
          Window{' '}
          <select
            aria-label="Usage window"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <div className={styles.tableScroll}>
        <table>
          <thead>
            <tr>
              <th>Feature / template</th>
              <th>Provider / model</th>
              <th>Outcome</th>
              <th>Requests</th>
              <th>Input / output tokens</th>
              <th>Avg. model latency</th>
              <th>Estimated cost</th>
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
                  {row.model ?? 'Unknown'}
                  <small>
                    {row.provider ?? 'Unknown'} · {row.modelVersion ?? 'Unknown'}
                  </small>
                </td>
                <td>{row.status}</td>
                <td>{number(row.requests)}</td>
                <td>
                  {number(row.inputTokens)} / {number(row.outputTokens)}
                  <small>
                    {row.usageKnown}/{row.requests} known · {row.estimatedUsageRequests}{' '}
                    estimated
                  </small>
                </td>
                <td>{duration(Math.round(row.averageLatencyMs))}</td>
                <td>
                  {cost(row.estimatedCostUsd)}
                  <small>
                    {row.costKnown}/{row.requests} priced
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overview.usage.length === 0 ? <p>No model calls in this window.</p> : null}
      <p className={styles.disclaimer}>
        Unknown usage is excluded from totals. Costs use configured token rates and are
        estimates; provider invoices may differ.
      </p>
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
  const { trace, usage, chunks } = detail;
  const response = trace.response;
  const claims = response?.generation?.result.answer.claims ?? [];
  return (
    <>
      <div className={styles.requestBar}>
        <code title={trace.correlationId}>Request {trace.correlationId}</code>
        <span className={styles.status} data-status={trace.status}>
          {trace.status}
        </span>
        <time>{trace.startedAt}</time>
      </div>
      <div className={styles.columns}>
        <section className={styles.card} aria-label="Query and configuration">
          <h2>Query & configuration</h2>
          <p className={styles.query}>
            {trace.query ?? 'Private query was not captured.'}
          </p>
          <dl>
            <dt>Trace ID</dt>
            <dd>{trace.id}</dd>
            <dt>Generation ID</dt>
            <dd>{trace.generationRequestId ?? 'Not run'}</dd>
            <dt>Workspace</dt>
            <dd>{trace.workspaceId}</dd>
            <dt>Retrieval filters</dt>
            <dd>
              {trace.selectedSourceIds === null
                ? 'All authorized sources'
                : trace.selectedSourceIds.length === 0
                  ? 'No sources selected'
                  : trace.selectedSourceIds.join(', ')}
            </dd>
            <dt>Computed outputs</dt>
            <dd>{trace.selectedAnalysisOutputs.length}</dd>
            <dt>Retrieval</dt>
            <dd>Hybrid vector + lexical · k={trace.topK}</dd>
            <dt>Reranking</dt>
            <dd>Not applicable · no reranker configured</dd>
            <dt>Model</dt>
            <dd>
              {usage?.model
                ? `${usage.model.provider} / ${usage.model.name} / ${usage.model.version}`
                : 'Unknown'}
            </dd>
            <dt>Template</dt>
            <dd>{trace.templateId}</dd>
            <dt>Template hash</dt>
            <dd>{trace.templateHash}</dd>
            <dt>Temperature</dt>
            <dd>{trace.parameters.temperature ?? 'Provider default'}</dd>
            <dt>Max output tokens</dt>
            <dd>{number(trace.parameters.maxOutputTokens)}</dd>
            <dt>Retrieval latency</dt>
            <dd>{duration(trace.retrievalLatencyMs)}</dd>
            <dt>Model latency</dt>
            <dd>{duration(usage?.latencyMs)}</dd>
            <dt>Input / output tokens</dt>
            <dd>
              {number(usage?.usage?.inputTokens)} / {number(usage?.usage?.outputTokens)}
              {usage?.usage?.estimated ? ' (estimated)' : ''}
            </dd>
            <dt>Cost estimate</dt>
            <dd>
              {cost(usage?.cost?.usd)}
              <small>
                {usage?.cost
                  ? `Rate version: ${usage.cost.pricingVersion}`
                  : 'No matching price or usage available'}
              </small>
            </dd>
          </dl>
          {trace.errorCode ? (
            <p className={styles.failure} role="alert">
              {trace.errorCode}. Inspect the completed stages and retry from Ask
              Workspace.
            </p>
          ) : null}
        </section>
        <section className={styles.card} aria-label="Retrieved chunks">
          <div className={styles.sectionHeading}>
            <h2>Retrieved chunks</h2>
            <span>{chunks.length} retrieved</span>
          </div>
          <p className={styles.disclaimer}>
            Original hybrid order. Scores are ranking signals, not answer confidence.
          </p>
          {chunks.length === 0 ? (
            <p>
              No chunks retrieved. Check filters, source readiness and the error code.
            </p>
          ) : (
            <div className={styles.chunkList}>
              {chunks.map((chunk, index) => {
                const citation = chunk.hit.citation;
                const title =
                  response?.generation?.evidence.find(
                    (item) => item.chunkId === citation.chunkId,
                  )?.title ??
                  citation.sectionTitle ??
                  'Source';
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
                          ? `${chunk.citationKey} · in context`
                          : 'Not in context'}
                      </span>
                    </div>
                    <p className={styles.snippet}>
                      {chunk.text ??
                        (chunk.availability === 'SOURCE_UNAVAILABLE'
                          ? 'This source version is no longer available.'
                          : 'Retrieved text capture is disabled.')}
                    </p>
                    <dl className={styles.chunkStats}>
                      <dt>Score</dt>
                      <dd>{chunk.hit.score.toFixed(4)}</dd>
                      <dt>Vector</dt>
                      <dd>{chunk.hit.vectorSimilarity.toFixed(4)}</dd>
                      <dt>Lexical</dt>
                      <dd>{chunk.hit.lexicalScore.toFixed(4)}</dd>
                      <dt>Bytes</dt>
                      <dd>{number(chunk.hit.contentBytes)}</dd>
                    </dl>
                    <small>
                      Page {citation.pageStart ?? 'n/a'}
                      {citation.pageEnd !== citation.pageStart
                        ? `–${citation.pageEnd}`
                        : ''}{' '}
                      · {citation.processingVersion}
                      {chunk.textReference
                        ? ` · shared text with ${chunk.textReference}`
                        : ''}
                    </small>
                    <code className={styles.chunkId}>{citation.chunkId}</code>
                    <small>
                      Source {citation.sourceId} · version{' '}
                      {citation.sourceVersionId ?? 'legacy'}
                    </small>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className={styles.right}>
          <section className={styles.card} aria-label="Context assembly">
            <h2>Context assembly</h2>
            <div className={styles.contextNumber}>
              {number(trace.context?.tokenUpperBound)}
              <small>conservative request token bound</small>
            </div>
            <dl>
              <dt>Context bytes</dt>
              <dd>{number(trace.context?.contextBytes)}</dd>
              <dt>Token budget</dt>
              <dd>{number(trace.context?.budget.maxTokens)}</dd>
              <dt>Byte budget</dt>
              <dd>{number(trace.context?.budget.maxBytes)}</dd>
              <dt>Builder</dt>
              <dd>{trace.context?.builderVersion ?? 'Not run'}</dd>
              <dt>Policy</dt>
              <dd>{trace.context?.tokenPolicy ?? 'Not run'}</dd>
            </dl>
            <p className={styles.disclaimer}>
              The UTF-8 bound reserves context capacity. Provider token usage is measured
              separately.
            </p>
          </section>
          <section className={styles.card} aria-label="Answer and citations">
            <h2>Answer & citations</h2>
            {response === null ? (
              <p>
                {trace.errorCode
                  ? 'No validated answer was produced.'
                  : 'Private answer was not captured.'}
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
                    Final structured citations (
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
