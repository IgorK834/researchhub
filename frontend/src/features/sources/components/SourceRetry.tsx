import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
        {uiText('ui.CanvasContextPreview.message004')}
      </Button>
      {retry.error ? (
        <p role="alert">
          {uiText('ui.SourceProcessing.message007')} {describeError(retry.error)}
        </p>
      ) : null}
    </>
  );
}
