import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api';
import { fetchSourceProcessing } from '../api/sourceApi';
import styles from './Sources.module.css';

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

/** Server-reported processing progress only; uploading bytes is a separate operation. */
export function SourceProgress({
  workspaceId,
  sourceId,
}: {
  readonly workspaceId: string;
  readonly sourceId: string;
}): ReactElement {
  useUiLocale();
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
          ? uiText('ui.SourceProgress.message001')
          : stage
            ? `${stageLabels[stage]} · ${data.progress}%`
            : uiText('ui.SourceProcessing.message002')}
      </p>
      {stage ? (
        <progress
          aria-label={uiText('ui.SourceProcessing.message003')}
          max={100}
          value={data.progress}
        />
      ) : null}
    </div>
  );
}
