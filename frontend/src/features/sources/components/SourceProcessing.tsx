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
    EXTRACT: 'Reading source',
    CHUNK: 'Preparing source fragments',
    EMBED: 'Making source searchable',
    INDEX: 'Saving searchable fragments',
    FINALIZE: 'Finishing processing',
  };
  return (
    <section aria-label="Source processing">
      {busy ? (
        <p role="status">
          Source processing is in progress. Status updates automatically.
        </p>
      ) : null}
      {busy && processing.data?.stage ? (
        <div aria-live="polite">
          <p>
            {stageLabels[processing.data.stage]} · {processing.data.progress}%
          </p>
          <progress
            aria-label="Source processing progress"
            value={processing.data.progress}
            max={100}
          />
        </div>
      ) : null}
      {busy && processing.error ? (
        <p role="alert">
          Could not load processing progress: {describeError(processing.error)}
        </p>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          disabled={busy || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Reprocess source
        </button>
      ) : null}
      {mutation.error ? (
        <p role="alert">Could not reprocess source: {describeError(mutation.error)}</p>
      ) : null}
      {error ? (
        <p role="alert">Could not load processing history: {describeError(error)}</p>
      ) : null}
      {(data?.length ?? 0) > 0 ? (
        <details>
          <summary>Processing history</summary>
          <ol>
            {data?.map((run) => (
              <li key={run.jobId}>
                {run.parserVersion} · {run.processingVersion} · {run.jobStatus} ·{' '}
                <time dateTime={run.persistedAt}>
                  {new Date(run.persistedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
