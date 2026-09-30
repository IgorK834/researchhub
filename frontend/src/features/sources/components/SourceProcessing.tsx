import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
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
  return (
    <section aria-label="Source processing">
      {busy ? (
        <p role="status">
          Source processing is in progress. Status updates automatically.
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
