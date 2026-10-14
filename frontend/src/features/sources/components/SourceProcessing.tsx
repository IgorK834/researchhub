import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { Panel } from '../../../shared/components/content';
import { Progress } from '../../../shared/components/feedback';
import { Button } from '../../../shared/components/Button';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { fetchSourceProcessing } from '../api/sourceApi';
import { fetchExtractionRuns } from '../api/sourceExtraction';
import { useReprocessSource } from '../api/useSources';
import type { SourceStatus } from '../api/sourceTypes';

export function SourceProcessing({
  workspaceId,
  sourceId,
  status,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly status: SourceStatus;
  readonly canEdit: boolean;
}): ReactElement {
  useUiLocale();
  const mutation = useReprocessSource(workspaceId, sourceId);
  const busy = status === 'UPLOADED' || status === 'PROCESSING';
  const { data, error } = useQuery({
    enabled: !busy,
    queryKey: queryKeys.extractionRuns(workspaceId, sourceId),
    queryFn: ({ signal }) => fetchExtractionRuns(workspaceId, sourceId, signal),
  });
  const processing = useQuery({
    enabled: busy,
    queryKey: queryKeys.sourceProcessing(workspaceId, sourceId),
    queryFn: async ({ signal }) =>
      (await fetchSourceProcessing(workspaceId, sourceId, signal)) ?? null,
    refetchInterval: busy ? 2000 : false,
  });
  const stageLabels = {
    get EXTRACT() {
      return uiText('ui.SourceProcessing.message010');
    },
    get CHUNK() {
      return uiText('ui.SourceProcessing.message011');
    },
    get EMBED() {
      return uiText('ui.SourceProcessing.message012');
    },
    get INDEX() {
      return uiText('ui.SourceProcessing.message013');
    },
    get FINALIZE() {
      return uiText('ui.SourceProcessing.message014');
    },
  };
  return (
    <Panel title={uiText('ui.SourceProcessing.message001')}>
      {busy ? <p role="status">{uiText('ui.SourceProcessing.message002')}</p> : null}
      {busy && processing.data?.stage ? (
        <div aria-live="polite">
          <p>
            {stageLabels[processing.data.stage]} · {processing.data.progress}%
          </p>
          <Progress
            label={uiText('ui.SourceProcessing.message003')}
            value={processing.data.progress}
          />
        </div>
      ) : null}
      {busy && processing.error ? (
        <p role="alert">
          {uiText('ui.SourceProcessing.message004')} {describeError(processing.error)}
        </p>
      ) : null}
      {canEdit ? (
        <Button
          variant="secondary"
          icon="refresh"
          type="button"
          disabled={busy || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {status === 'FAILED'
            ? uiText('ui.SourceProcessing.message005')
            : uiText('ui.SourceProcessing.message006')}
        </Button>
      ) : null}
      {mutation.error ? (
        <p role="alert">
          {uiText('ui.SourceProcessing.message007')} {describeError(mutation.error)}
        </p>
      ) : null}
      {error ? (
        <p role="alert">
          {uiText('ui.SourceProcessing.message008')} {describeError(error)}
        </p>
      ) : null}
      {(data?.length ?? 0) > 0 ? (
        <details>
          <summary>{uiText('ui.SourceProcessing.message009')}</summary>
          <ol>
            {data?.map((run) => (
              <li key={run.jobId}>
                {run.parserVersion} · {run.processingVersion} · {run.jobStatus} ·{' '}
                <time dateTime={run.persistedAt}>
                  {new Date(run.persistedAt).toLocaleString(getIntlLocale())}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Panel>
  );
}
