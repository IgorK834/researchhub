import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Card } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import { Badge } from '../../../shared/components/identity';
import { Dialog } from '../../../shared/components/overlays';
import { useArchiveWorkspace } from '../api/useWorkspaces';
import styles from './WorkspaceViews.module.css';

/** Server-authorized soft archive. Confirmation promises retained data and access, never restoration. */
export function ArchiveWorkspaceButton({
  workspaceId,
  workspaceName,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
}): ReactElement {
  useUiLocale();
  const navigate = useNavigate();
  const { mutate, isPending, error, reset } = useArchiveWorkspace(workspaceId);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Card className={styles.archiveCard}>
      <div className={styles.archiveHeader}>
        <h2 id="archive-workspace-heading">
          {uiText('ui.ArchiveWorkspaceButton.message001')}
        </h2>
        <Badge
          label={uiText('ui.ArchiveWorkspaceButton.message002')}
          icon="lock"
          tone="ink"
        />
      </div>
      <p>{uiText('ui.ArchiveWorkspaceButton.message003')}</p>
      <Button
        ref={trigger}
        variant="danger-soft"
        icon="archive"
        onClick={() => {
          reset();
          setConfirming(true);
        }}
      >
        {uiText('ui.ArchiveWorkspaceButton.message001')}
      </Button>
      <Dialog
        open={confirming}
        title={uiText('ui.ArchiveWorkspaceButton.message004', { value0: workspaceName })}
        description={uiText('ui.ArchiveWorkspaceButton.message005')}
        initialFocusRef={cancel}
        returnFocusRef={trigger}
        dismissible={!isPending}
        closeDisabled={isPending}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button
              ref={cancel}
              variant="secondary"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              {uiText('ui.InsertAnalysisResult.message019')}
            </Button>
            <Button
              icon="archive"
              busy={isPending}
              busyLabel={uiText('ui.DocumentEditorForm.message020')}
              aria-label={
                isPending ? uiText('ui.DocumentEditorForm.message020') : undefined
              }
              onClick={() => {
                mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    void navigate('/app/workspaces');
                  },
                });
              }}
            >
              {uiText('ui.ArchiveWorkspaceButton.message001')}
            </Button>
          </>
        }
      >
        <Card className={styles.retainedNotice}>
          <strong>{uiText('ui.ArchiveWorkspaceButton.message006')}</strong>{' '}
          {uiText('ui.ArchiveWorkspaceButton.message007')}
        </Card>
        {error !== null ? <Banner tone="error" lead={describeError(error)} /> : null}
      </Dialog>
    </Card>
  );
}
