import type { ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { sourceContentPath } from '../api/sourceApi';
import { SOURCE_STATUS_LABELS } from '../api/sourceTypes';
import { useSourcesQuery } from '../api/useSources';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${String(bytes)} B`;
}

/** Every workspace member can see and download the immutable research inputs. */
export function SourceList({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  const { data: sources, error, isPending } = useSourcesQuery(workspaceId);

  return (
    <section aria-labelledby="workspace-sources-heading">
      <h2 id="workspace-sources-heading">Sources</h2>
      {isPending ? (
        <p role="status" aria-live="polite">
          Loading sources…
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert">Could not load the sources: {describeError(error)}</p>
      ) : null}
      {sources !== undefined && error === null ? (
        sources.length === 0 ? (
          <p>No sources yet.</p>
        ) : (
          <ul>
            {sources.map((source) => (
              <li key={source.id}>
                <a
                  href={sourceContentPath(workspaceId, source.id)}
                  download={source.displayName}
                >
                  {source.displayName}
                </a>{' '}
                — {source.sourceType}, {formatBytes(source.sizeBytes)},{' '}
                <span aria-label="Source status">
                  {SOURCE_STATUS_LABELS[source.status]}
                </span>
                {source.failureSummary !== null ? (
                  <p>Failure: {source.failureSummary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
