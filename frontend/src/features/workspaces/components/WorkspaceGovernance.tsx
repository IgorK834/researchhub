import { useState, type ReactElement } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { downloadAudit, fetchAiUsage } from '../api/governanceApi';

export function WorkspaceGovernance({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  const [days, setDays] = useState(30);
  const usage = useQuery({
    queryKey: ['workspace-ai-usage', workspaceId, days],
    queryFn: ({ signal }) => fetchAiUsage(workspaceId, days, signal),
    retry: false,
  });
  const download = useMutation({
    mutationFn: (format: 'csv' | 'json') => downloadAudit(workspaceId, format),
  });
  return (
    <section aria-label="Workspace governance">
      <h2>AI consumption and audit</h2>
      <label>
        Usage window{' '}
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>
      {usage.isPending ? <p role="status">Loading AI usage…</p> : null}
      {usage.error ? (
        <p role="alert">Could not load AI usage: {describeError(usage.error)}</p>
      ) : null}
      {usage.data ? (
        <>
          {usage.data.features.length === 0 ? (
            <p>No AI requests in this window.</p>
          ) : (
            <table>
              <caption>AI usage by feature</caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Failures</th>
                  <th scope="col">Input tokens</th>
                  <th scope="col">Output tokens</th>
                  <th scope="col">Known usage</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.features.map((f) => (
                  <tr key={f.feature}>
                    <th scope="row">{f.feature}</th>
                    <td>{f.requests}</td>
                    <td>{f.failures}</td>
                    <td>{f.inputTokens ?? 'Unknown'}</td>
                    <td>{f.outputTokens ?? 'Unknown'}</td>
                    <td>
                      {f.usageKnown} of {f.requests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>
            Token totals include requests with known usage. Missing provider usage is
            shown as unknown.
          </p>
          <h3>Current request quotas</h3>
          <ul>
            {usage.data.quotas.map((q) => (
              <li key={q.category}>
                {q.category}: {q.requests} / {q.limit} workspace requests · resets{' '}
                <time dateTime={q.resetsAt}>{new Date(q.resetsAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Export audit trail</h3>
      <p>
        Includes product, review and AI call event headers. Exports contain no prompts or
        document text. Maximum 100,000 events per export.
      </p>
      {(['csv', 'json'] as const).map((format) => (
        <Button
          key={format}
          variant="secondary"
          disabled={download.isPending}
          onClick={() => download.mutate(format)}
        >
          Export {format.toUpperCase()}
        </Button>
      ))}
      {download.isPending ? <p role="status">Preparing audit export…</p> : null}
      {download.error ? (
        <p role="alert">Could not export audit: {describeError(download.error)}</p>
      ) : null}
    </section>
  );
}
