import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
    <section aria-label={uiText('ui.WorkspaceGovernance.message001')}>
      <h2>{uiText('ui.WorkspaceGovernance.message002')}</h2>
      <label>
        {uiText('ui.WorkspaceGovernance.message003')}{' '}
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>{uiText('ui.WorkspaceGovernance.message004')}</option>
          <option value={30}>{uiText('ui.WorkspaceGovernance.message005')}</option>
          <option value={90}>{uiText('ui.WorkspaceGovernance.message006')}</option>
        </select>
      </label>
      {usage.isPending ? (
        <p role="status">{uiText('ui.WorkspaceGovernance.message007')}</p>
      ) : null}
      {usage.error ? (
        <p role="alert">
          {uiText('ui.WorkspaceGovernance.message008')} {describeError(usage.error)}
        </p>
      ) : null}
      {usage.data ? (
        <>
          {usage.data.features.length === 0 ? (
            <p>{uiText('ui.WorkspaceGovernance.message009')}</p>
          ) : (
            <table>
              <caption>{uiText('ui.WorkspaceGovernance.message010')}</caption>
              <thead>
                <tr>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message011')}</th>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message012')}</th>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message013')}</th>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message014')}</th>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message015')}</th>
                  <th scope="col">{uiText('ui.WorkspaceGovernance.message016')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.features.map((f) => (
                  <tr key={f.feature}>
                    <th scope="row">{f.feature}</th>
                    <td>{f.requests}</td>
                    <td>{f.failures}</td>
                    <td>{f.inputTokens ?? uiText('ui.ProblemForm.message012')}</td>
                    <td>{f.outputTokens ?? uiText('ui.ProblemForm.message012')}</td>
                    <td>
                      {f.usageKnown} {uiText('ui.AnalysisWidgets.message012')}{' '}
                      {f.requests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>{uiText('ui.WorkspaceGovernance.message017')}</p>
          <h3>{uiText('ui.WorkspaceGovernance.message018')}</h3>
          <ul>
            {usage.data.quotas.map((q) => (
              <li key={q.category}>
                {q.category}: {q.requests} / {q.limit}{' '}
                {uiText('ui.WorkspaceGovernance.message019')}{' '}
                <time dateTime={q.resetsAt}>
                  {new Date(q.resetsAt).toLocaleString(getIntlLocale())}
                </time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>{uiText('ui.WorkspaceGovernance.message020')}</h3>
      <p>{uiText('ui.WorkspaceGovernance.message021')}</p>
      {(['csv', 'json'] as const).map((format) => (
        <Button
          key={format}
          variant="secondary"
          disabled={download.isPending}
          onClick={() => download.mutate(format)}
        >
          {uiText('ui.ExportDocument.message001')} {format.toUpperCase()}
        </Button>
      ))}
      {download.isPending ? (
        <p role="status">{uiText('ui.WorkspaceGovernance.message022')}</p>
      ) : null}
      {download.error ? (
        <p role="alert">
          {uiText('ui.WorkspaceGovernance.message023')} {describeError(download.error)}
        </p>
      ) : null}
    </section>
  );
}
