import { useEffect, useState } from 'react';

import { hasApiErrorCode } from '../../../shared/api';
import { useSaveDocument } from '../api/useDocuments';
import { AUTOSAVE_TIMING } from './autosaveTiming';
import {
  DocumentAutosave,
  type AutosaveState,
  type DocumentDraft,
} from './documentAutosave';

export interface UseDocumentAutosave extends AutosaveState {
  readonly savedAt: string;
  /** Records an edit. Saving is scheduled, never immediate. */
  readonly edit: (draft: DocumentDraft) => void;
  /** An explicit save, recorded as a version. */
  readonly saveNow: () => void;
  /** Tries a failed save again. */
  readonly retry: () => void;
}

/**
 * Binds a {@link DocumentAutosave} to the mounted editor.
 *
 * One controller per mount, created from the initial values and never recreated. The page remounts the editor —
 * with a new key — when the user loads the latest version or restores an old one, which is also what gives the
 * controller its new starting revision.
 *
 * Three things happen at the edges of the page's life:
 *
 * - **Leaving the document** (unmount, including navigating to another document) flushes pending edits instead of
 *   dropping them. The save still completes and still lands in the query cache after the editor is gone.
 * - **Closing the tab** with unsaved edits asks the browser to confirm, because that request could not finish.
 * - **Coming back online** retries a failed save, so an offline stretch recovers without a click.
 */
export function useDocumentAutosave(
  workspaceId: string,
  documentId: string,
  initialDraft: DocumentDraft,
  initialRevision: number,
  initialSavedAt: string,
): UseDocumentAutosave {
  const save = useSaveDocument(workspaceId, documentId);
  const [savedAt, setSavedAt] = useState(initialSavedAt);

  const [state, setState] = useState<AutosaveState>(() => ({
    status: 'saved',
    revision: initialRevision,
    error: null,
    blocked: false,
  }));

  const [controller] = useState(
    () =>
      new DocumentAutosave({
        initialDraft,
        initialRevision,
        timing: AUTOSAVE_TIMING,
        save: async (draft, revision, saveKind) => {
          const stored = await save({
            title: draft.title,
            content: draft.content,
            revision,
            saveKind,
          });
          setSavedAt(stored.updatedAt);
          return stored;
        },
        isConflict: (error) => hasApiErrorCode(error, 'CONFLICT'),
        onChange: setState,
      }),
  );

  useEffect(
    () => () => {
      controller.flush();
      controller.dispose();
    },
    [controller],
  );

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent): void => {
      if (controller.hasUnsavedChanges) {
        event.preventDefault();
      }
    };
    const retryWhenOnline = (): void => {
      controller.retry();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('online', retryWhenOnline);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('online', retryWhenOnline);
    };
  }, [controller]);

  return {
    ...state,
    savedAt,
    edit: (draft) => controller.edit(draft),
    saveNow: () => controller.saveNow(),
    retry: () => controller.retry(),
  };
}
