import type { ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { describeError } from '../../../shared/api';
import { useReprocessSource } from '../api/useSources';

export function SourceRetry({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  const retry = useReprocessSource(workspaceId, sourceId);
  return (
    <>
      <Button
        variant="secondary"
        size="compact"
        icon="refresh"
        busy={retry.isPending}
        onClick={() => retry.mutate()}
      >
        Retry
      </Button>
      {retry.error ? (
        <p role="alert">Could not reprocess source: {describeError(retry.error)}</p>
      ) : null}
    </>
  );
}
