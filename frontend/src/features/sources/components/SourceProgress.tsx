import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api';
import { fetchSourceProcessing } from '../api/sourceApi';
import styles from './Sources.module.css';

const stageLabels = {
  EXTRACT: 'Reading source',
  CHUNK: 'Preparing source fragments',
  EMBED: 'Making source searchable',
  INDEX: 'Saving searchable fragments',
  FINALIZE: 'Finishing processing',
};

/** Server-reported processing progress only; uploading bytes is a separate operation. */
export function SourceProgress({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  const { data, error } = useQuery({
    queryKey: queryKeys.sourceProcessing(workspaceId, sourceId),
    queryFn: async ({ signal }) =>
      (await fetchSourceProcessing(workspaceId, sourceId, signal)) ?? null,
    refetchInterval: 2000,
  });
  const stage = data?.stage;
  return (
    <div className={styles.processing} aria-live="polite">
      <p>
        {error
          ? 'Processing source. Progress is temporarily unavailable.'
          : stage
            ? `${stageLabels[stage]} · ${data.progress}%`
            : 'Source processing is in progress. Status updates automatically.'}
      </p>
      {stage ? (
        <progress
          aria-label="Source processing progress"
          max={100}
          value={data.progress}
        />
      ) : null}
    </div>
  );
}
