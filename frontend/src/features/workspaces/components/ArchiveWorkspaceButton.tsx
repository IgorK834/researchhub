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
  const navigate = useNavigate();
  const { mutate, isPending, error, reset } = useArchiveWorkspace(workspaceId);
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Card className={styles.archiveCard}>
      <div className={styles.archiveHeader}>
        <h2 id="archive-workspace-heading">Archive workspace</h2>
        <Badge label="Owner only" icon="lock" tone="ink" />
      </div>
      <p>
        Removes this workspace from everyone&apos;s active workspace list. Members keep
        their access through its link. Nothing is deleted.
      </p>
      <Button
        ref={trigger}
        variant="danger-soft"
        icon="archive"
        onClick={() => {
          reset();
          setConfirming(true);
        }}
      >
        Archive workspace
      </Button>
      <Dialog
        open={confirming}
        title={`Archive ${workspaceName}?`}
        description="Archiving removes this workspace from the active workspace list."
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
              Cancel
            </Button>
            <Button
              icon="archive"
              busy={isPending}
              busyLabel="Archiving…"
              aria-label={isPending ? 'Archiving…' : undefined}
              onClick={() => {
                mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    void navigate('/app/workspaces');
                  },
                });
              }}
            >
              Archive workspace
            </Button>
          </>
        }
      >
        <Card className={styles.retainedNotice}>
          <strong>No files or documents will be deleted.</strong> Sources and every
          document version are retained. Members keep their access, and the workspace
          remains readable through its link. Its content can no longer be changed.
        </Card>
        {error !== null ? <Banner tone="error" lead={describeError(error)} /> : null}
      </Dialog>
    </Card>
  );
}
