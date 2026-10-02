import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { Banner, ToastHost } from '../../../shared/components/feedback';
import { Icon } from '../../../shared/components/icons';
import styles from './DocumentFrame.module.css';

/** Informational feedback for a confirmed Viewer role. No access request or unsupported comments action. */
export function DocumentViewerNotice({
  statusHost,
}: {
  readonly statusHost?: HTMLElement;
}): ReactElement {
  const [dismissed, setDismissed] = useState(false);
  const chip = (
    <p className={styles.saveStatus} data-status="readonly">
      <Icon name="eye" size={14} />
      <strong>Read-only</strong>
    </p>
  );
  return (
    <>
      {statusHost === undefined ? chip : createPortal(chip, statusHost)}
      <div className={styles.viewerNotice}>
        <Banner tone="info" icon="eye" lead="You’re a viewer in this workspace.">
          You can read this document and ask AI about it. Only editors can change the
          document.
        </Banner>
      </div>
      <ToastHost
        entries={
          dismissed
            ? []
            : [
                {
                  id: 1,
                  input: {
                    tone: 'info',
                    icon: 'lock',
                    duration: 0,
                    title: 'Only editors can change this document',
                    message: 'You can still read the document and ask AI about it.',
                  },
                },
              ]
        }
        dismiss={() => setDismissed(true)}
      />
    </>
  );
}
