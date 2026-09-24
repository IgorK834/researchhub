import { useState, type ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import type { DocumentVersionReason, WorkspaceDocument } from '../api/documentApi';
import { readStoredDocument } from '../api/documentContent';
import {
  useDocumentVersionQuery,
  useDocumentVersionsQuery,
  useRestoreDocumentVersion,
} from '../api/useDocuments';
import { DocumentBodyEditor } from './DocumentBodyEditor';

interface DocumentHistoryProps {
  readonly workspaceId: string;
  readonly documentId: string;
  /** The revision on screen, sent with a restore so it cannot replace text the user has not seen. */
  readonly revision: number;
  /** Whether the restore action is offered at all: an editor, on an active document. */
  readonly canRestore: boolean;
  /**
   * Why restoring is not possible right now even though `canRestore` is true — unsaved edits, for example — or
   * `null` when it is.
   */
  readonly restoreBlockedReason: string | null;
  /** Called with the document a restore produced. The page shows it in place of the editor's content. */
  readonly onRestored: (document: WorkspaceDocument) => void;
}

const REASONS: Readonly<Record<DocumentVersionReason, string>> = {
  CREATED: 'Created',
  MANUAL_SAVE: 'Saved version',
  AUTOSAVE_CHECKPOINT: 'Autosave checkpoint',
  RESTORE: 'Restored',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * The document's restore points, collapsed until opened.
 *
 * Every member can read the history. Restoring is for editors, and it never deletes anything: the old text
 * becomes the next revision, and the list gains a "Restored" entry rather than losing the ones after it. Restoring
 * asks for confirmation first, and is unavailable while the editor has unsaved changes, because it would replace
 * them.
 */
export function DocumentHistory({
  workspaceId,
  documentId,
  revision,
  canRestore,
  restoreBlockedReason,
  onRestored,
}: DocumentHistoryProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const versions = useDocumentVersionsQuery(workspaceId, documentId, open);
  const preview = useDocumentVersionQuery(workspaceId, documentId, previewId);
  const restore = useRestoreDocumentVersion(workspaceId, documentId);

  const previewBody =
    preview.data === undefined ? null : readStoredDocument(preview.data.content);

  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Version history</summary>

      {versions.isPending && open ? (
        <p role="status" aria-live="polite">
          Loading versions…
        </p>
      ) : null}
      {versions.error !== null ? (
        <p role="alert">Could not load the history: {describeError(versions.error)}</p>
      ) : null}
      {restore.error !== null ? (
        <p role="alert">Could not restore: {describeError(restore.error)}</p>
      ) : null}
      {canRestore && restoreBlockedReason !== null ? <p>{restoreBlockedReason}</p> : null}

      {versions.data === undefined ? null : (
        <ol aria-label="Versions">
          {versions.data.map((version) => {
            const label = `revision ${String(version.revision)}`;
            return (
              <li key={version.id}>
                <span>
                  Revision {version.revision} · {REASONS[version.reason]} ·{' '}
                  {formatTime(version.createdAt)}
                </span>{' '}
                <button
                  type="button"
                  aria-label={`Preview ${label}`}
                  aria-pressed={previewId === version.id}
                  onClick={() => {
                    setPreviewId(previewId === version.id ? null : version.id);
                  }}
                >
                  Preview
                </button>
                {canRestore && confirmingId !== version.id ? (
                  <button
                    type="button"
                    aria-label={`Restore ${label}`}
                    disabled={restoreBlockedReason !== null || restore.isPending}
                    onClick={() => {
                      setConfirmingId(version.id);
                    }}
                  >
                    Restore
                  </button>
                ) : null}
                {canRestore && confirmingId === version.id ? (
                  <span>
                    {' '}
                    Replace the current text with {label}? It becomes revision{' '}
                    {revision + 1}; nothing is deleted.{' '}
                    <button
                      type="button"
                      disabled={restoreBlockedReason !== null || restore.isPending}
                      onClick={() => {
                        restore.mutate(
                          { versionId: version.id, revision },
                          {
                            onSuccess: (restored) => {
                              setConfirmingId(null);
                              onRestored(restored);
                            },
                          },
                        );
                      }}
                    >
                      {restore.isPending ? 'Restoring…' : `Confirm restore of ${label}`}
                    </button>{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : null}
                {previewId === version.id ? (
                  <div aria-label={`Contents of ${label}`} role="region">
                    {preview.isPending ? (
                      <p role="status">Loading this version…</p>
                    ) : null}
                    {preview.error !== null ? (
                      <p role="alert">
                        Could not load this version: {describeError(preview.error)}
                      </p>
                    ) : null}
                    {preview.data !== undefined && previewBody === null ? (
                      <p>This version contains content this editor cannot display.</p>
                    ) : null}
                    {previewBody === null ? null : (
                      <DocumentBodyEditor
                        key={version.id}
                        initialContent={previewBody}
                        editable={false}
                        onChange={() => undefined}
                        label={`Text of ${label}`}
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
