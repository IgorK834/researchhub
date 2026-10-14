import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import styles from './DocumentFrame.module.css';
import { Icon } from '../../../shared/components/icons';
import { Button } from '../../../shared/components/Button';
import { Banner, Spinner } from '../../../shared/components/feedback';

import { describeError, fieldErrorsByName, isApiError } from '../../../shared/api';
import type { AutosaveState } from '../autosave/documentAutosave';

export interface SaveStatusProps {
  readonly blockedReason?: string | undefined;
  readonly failureDetail?: string | undefined;
  readonly statusHost?: HTMLElement;
  readonly state: AutosaveState;
  /** The server timestamp of the acknowledged stored document, never the browser clock. */
  readonly savedAt: string;
  readonly onRetry: () => void;
  /** Reloads the stored document and drops local edits. Offered only for a conflict. */
  readonly onDiscardLocalChanges: () => void;
}

const LABELS = {
  get saved() {
    return uiText('ui.SaveStatus.message009');
  },
  get unsaved() {
    return uiText('ui.SaveStatus.message010');
  },
  get saving() {
    return uiText('ui.BibliographyLibrary.message022');
  },
  get failed() {
    return uiText('ui.SaveStatus.message011');
  },
  get conflict() {
    return uiText('ui.SaveStatus.message012');
  },
} as const;

/**
 * What the editor knows about whether the text on screen is stored.
 *
 * The one-word state is a live region, so a screen reader hears it change without it stealing focus. A failure
 * or a conflict adds an alert that says what happened and — the part that matters — that the user's text is
 * still here. Field errors (a title the server refused) are shown next to their field instead of here.
 */
export function SaveStatus({
  state,
  onRetry,
  onDiscardLocalChanges,
  statusHost,
  savedAt,
  blockedReason = uiText('ui.SaveStatus.message013'),
  failureDetail,
}: SaveStatusProps): ReactElement {
  useUiLocale();
  const { status, revision, error, blocked } = state;
  const hasFieldErrors = Object.keys(fieldErrorsByName(error)).length > 0;
  const currentRevision =
    status === 'conflict' && isApiError(error)
      ? error.problem.currentRevision
      : undefined;

  const badge = (
    <p
      role="status"
      aria-live="polite"
      className={styles.saveStatus}
      data-status={status}
    >
      {status === 'saving' ? (
        <Spinner decorative size={14} />
      ) : (
        <Icon
          name={
            status === 'saved'
              ? 'check'
              : status === 'conflict'
                ? 'warn'
                : status === 'unsaved'
                  ? 'clock'
                  : 'alert'
          }
          size={14}
        />
      )}
      <strong>{LABELS[status]}</strong>
      {status === 'saved' ? (
        <>
          <span>·</span>
          <time dateTime={savedAt} title={savedAt}>
            {Number.isNaN(new Date(savedAt).getTime())
              ? savedAt
              : new Date(savedAt).toLocaleTimeString(getIntlLocale(), {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
          </time>
          <span className="visually-hidden">
            {' '}
            {uiText('ui.SaveStatus.message001')} {revision}
          </span>
        </>
      ) : null}
      {status === 'unsaved' && blocked ? ` · ${blockedReason}` : null}
    </p>
  );

  return (
    <div>
      {statusHost === undefined ? badge : createPortal(badge, statusHost)}
      {status === 'failed' ? (
        <div className={styles.saveAlert}>
          <Banner tone="error" lead={uiText('ui.SaveStatus.message011')}>
            <p>
              {hasFieldErrors
                ? uiText('ui.SaveStatus.message002')
                : (failureDetail ?? describeError(error))}{' '}
              {uiText('ui.SaveStatus.message003')}
            </p>
            <Button variant="secondary" icon="refresh" type="button" onClick={onRetry}>
              {uiText('ui.SaveStatus.message004')}
            </Button>
          </Banner>
        </div>
      ) : null}

      {status === 'conflict' ? (
        <div className={styles.saveAlert}>
          <Banner tone="warning" role="alert" lead={uiText('ui.SaveStatus.message012')}>
            <p>{describeError(error)}</p>
            {currentRevision === undefined ? null : (
              <p>
                {uiText('ui.SaveStatus.message005')} {currentRevision}
                {uiText('ui.SaveStatus.message006')} {revision}.
              </p>
            )}
            <p>{uiText('ui.SaveStatus.message007')}</p>
            <Button
              variant="secondary"
              icon="refresh"
              type="button"
              onClick={onDiscardLocalChanges}
            >
              {uiText('ui.SaveStatus.message008')}
            </Button>
          </Banner>
        </div>
      ) : null}
    </div>
  );
}
