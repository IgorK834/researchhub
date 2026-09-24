import type { ReactElement } from 'react';

import { describeError, fieldErrorsByName, isApiError } from '../../../shared/api';
import type { AutosaveState } from '../autosave/documentAutosave';

interface SaveStatusProps {
  readonly state: AutosaveState;
  readonly onRetry: () => void;
  /** Reloads the stored document and drops local edits. Offered only for a conflict. */
  readonly onDiscardLocalChanges: () => void;
}

const LABELS = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Save failed',
  conflict: 'Conflict',
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
}: SaveStatusProps): ReactElement {
  const { status, revision, error, blocked } = state;
  const hasFieldErrors = Object.keys(fieldErrorsByName(error)).length > 0;
  const currentRevision =
    status === 'conflict' && isApiError(error)
      ? error.problem.currentRevision
      : undefined;

  return (
    <div>
      <p role="status" aria-live="polite">
        <strong>{LABELS[status]}</strong>
        {status === 'saved' ? ` · revision ${String(revision)}` : null}
        {status === 'unsaved' && blocked
          ? ' · a title is required before this can be saved'
          : null}
      </p>

      {status === 'failed' ? (
        <div role="alert">
          <p>
            {hasFieldErrors
              ? 'The server did not accept this version.'
              : describeError(error)}{' '}
            Your changes are still here and have not been saved. Saving will be tried
            again when you keep editing or come back online.
          </p>
          <button type="button" onClick={onRetry}>
            Retry saving
          </button>
        </div>
      ) : null}

      {status === 'conflict' ? (
        <div role="alert">
          <p>{describeError(error)}</p>
          {currentRevision === undefined ? null : (
            <p>
              The saved document is now at revision {currentRevision}. Your copy is based
              on revision {revision}.
            </p>
          )}
          <p>
            Your changes are still here and have not been saved. Autosave has stopped
            until you choose what to do.
          </p>
          <button type="button" onClick={onDiscardLocalChanges}>
            Discard my changes and load the latest version
          </button>
        </div>
      ) : null}
    </div>
  );
}
