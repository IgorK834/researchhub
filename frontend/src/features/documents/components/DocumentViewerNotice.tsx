import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
  const [dismissed, setDismissed] = useState(false);
  const chip = (
    <p className={styles.saveStatus} data-status="readonly">
      <Icon name="eye" size={14} />
      <strong>{uiText('ui.DocumentEditorForm.message011')}</strong>
    </p>
  );
  return (
    <>
      {statusHost === undefined ? chip : createPortal(chip, statusHost)}
      <div className={styles.viewerNotice}>
        <Banner
          tone="info"
          icon="eye"
          lead={uiText('ui.DocumentViewerNotice.message004')}
        >
          {uiText('ui.DocumentViewerNotice.message001')}
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
                    get title() {
                      return uiText('ui.DocumentViewerNotice.message002');
                    },
                    get message() {
                      return uiText('ui.DocumentViewerNotice.message003');
                    },
                  },
                },
              ]
        }
        dismiss={() => setDismissed(true)}
      />
    </>
  );
}
