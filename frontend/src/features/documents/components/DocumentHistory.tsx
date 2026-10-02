import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Icon, type IconName } from '../../../shared/components/icons';
import type { DocumentVersionReason, WorkspaceDocument } from '../api/documentApi';
import { readStoredDocument } from '../api/documentContent';
import {
  useDocumentVersionQuery,
  useDocumentVersionsQuery,
  useRestoreDocumentVersion,
} from '../api/useDocuments';
import { DocumentBodyEditor } from './DocumentBodyEditor';
import { DocumentVersionDiff } from './DocumentVersionDiff';
import styles from './DocumentHistory.module.css';

export interface DocumentHistoryProps {
  readonly expanded?: boolean;
  readonly workspaceId: string;
  readonly documentId: string;
  /** The revision acknowledged by autosave, used for the optimistic restore check. */
  readonly revision: number;
  /** Last server response. Comparison never uses the writer's unsaved draft. */
  readonly currentDocument: WorkspaceDocument;
  readonly authors: readonly { readonly userId: string; readonly name: string }[];
  readonly previewHost?: HTMLElement;
  readonly onPreviewChange?: (previewing: boolean) => void;
  readonly canRestore: boolean;
  readonly restoreBlockedReason: string | null;
  readonly onRestored: (document: WorkspaceDocument) => void;
}

const REASONS: Readonly<Record<DocumentVersionReason, string>> = {
  CREATED: 'Created',
  MANUAL_SAVE: 'Saved version',
  AUTOSAVE_CHECKPOINT: 'Autosave checkpoint',
  RESTORE: 'Restored',
  AI_ACCEPTANCE: 'AI suggestion accepted',
};
const REASON_ICONS: Readonly<Record<DocumentVersionReason, IconName>> = {
  CREATED: 'file',
  MANUAL_SAVE: 'bookmark',
  AUTOSAVE_CHECKPOINT: 'history',
  RESTORE: 'undo',
  AI_ACCEPTANCE: 'sparkle',
};
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Immutable restore points. Confirmation keeps the existing revision check and never discards unsaved edits. */
export function DocumentHistory({
  workspaceId,
  documentId,
  revision,
  currentDocument,
  authors,
  canRestore,
  restoreBlockedReason,
  onRestored,
  expanded,
  previewHost,
  onPreviewChange,
}: DocumentHistoryProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const isOpen = expanded ?? open;
  const versions = useDocumentVersionsQuery(workspaceId, documentId, isOpen);
  const preview = useDocumentVersionQuery(workspaceId, documentId, previewId);
  const restore = useRestoreDocumentVersion(workspaceId, documentId);
  const previewBody = useMemo(
    () => (preview.data === undefined ? null : readStoredDocument(preview.data.content)),
    [preview.data],
  );
  const currentBody = useMemo(
    () => readStoredDocument(currentDocument.content),
    [currentDocument.content],
  );
  useEffect(() => {
    onPreviewChange?.(isOpen && previewId !== null);
    return () => onPreviewChange?.(false);
  }, [isOpen, previewId, onPreviewChange]);
  const closePreview = (): void => setPreviewId(null);
  const comparison =
    previewId === null || !isOpen ? null : (
      <div>
        {preview.isPending ? <p role="status">Loading this version…</p> : null}
        {preview.error !== null ? (
          <p role="alert">Could not load this version: {describeError(preview.error)}</p>
        ) : null}
        {preview.data !== undefined && previewBody === null ? (
          <p>This version contains content this editor cannot display.</p>
        ) : null}
        {previewBody !== null && currentBody === null ? (
          <p>
            The current document contains content this editor cannot compare. Nothing has
            been changed.
          </p>
        ) : null}
        {previewBody !== null && currentBody !== null && preview.data !== undefined ? (
          <DocumentVersionDiff
            selected={previewBody}
            current={currentBody}
            selectedRevision={preview.data.revision}
            currentRevision={currentDocument.revision}
            title={currentDocument.title}
            onClose={closePreview}
          />
        ) : (
          <Button variant="secondary" onClick={closePreview}>
            Close version preview
          </Button>
        )}
      </div>
    );

  const contents = (
    <>
      <p className={styles.description}>
        Pick a version to preview it — nothing changes until you restore.
      </p>
      {versions.isPending && isOpen ? (
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
      {canRestore && restoreBlockedReason !== null ? (
        <p className={styles.blocked}>{restoreBlockedReason}</p>
      ) : null}
      {versions.data?.length === 0 ? <p>No versions yet.</p> : null}
      {versions.data === undefined ? null : (
        <ol aria-label="Versions" className={styles.versions}>
          {versions.data.map((version) => {
            const label = `revision ${String(version.revision)}`;
            const selected = previewId === version.id;
            const author =
              authors.find((member) => member.userId === version.createdBy)?.name ??
              'Unknown author';
            return (
              <li key={version.id} className={styles.version} data-selected={selected}>
                <div className={styles.versionHeading}>
                  <Icon name={REASON_ICONS[version.reason]} size={16} />
                  <strong>{REASONS[version.reason]}</strong>
                  <span className={styles.revision}>v{version.revision}</span>
                  <span className="visually-hidden">
                    Revision {version.revision} · {REASONS[version.reason]}
                  </span>
                </div>
                <span className={styles.meta}>
                  {author} ·{' '}
                  <time dateTime={version.createdAt}>
                    {formatTime(version.createdAt)}
                  </time>
                </span>
                <div className={styles.actions}>
                  <Button
                    variant="ghost"
                    icon="eye"
                    aria-label={`Preview ${label}`}
                    aria-pressed={selected}
                    onClick={() => setPreviewId(selected ? null : version.id)}
                  >
                    Preview
                  </Button>
                  {canRestore && confirmingId !== version.id ? (
                    <Button
                      variant={selected ? 'primary' : 'secondary'}
                      icon="history"
                      aria-label={`Restore ${label}`}
                      disabled={restoreBlockedReason !== null || restore.isPending}
                      onClick={() => {
                        setConfirmingId(version.id);
                      }}
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
                {canRestore && confirmingId === version.id ? (
                  <div className={styles.confirmation}>
                    <p>
                      Replace the current text with {label}? It becomes revision{' '}
                      {revision + 1}; nothing is deleted.
                    </p>
                    <div className={styles.actions}>
                      <Button
                        disabled={restoreBlockedReason !== null || restore.isPending}
                        onClick={() => {
                          restore.mutate(
                            { versionId: version.id, revision },
                            {
                              onSuccess: (restored) => {
                                setConfirmingId(null);
                                setPreviewId(null);
                                onRestored(restored);
                              },
                            },
                          );
                        }}
                      >
                        {restore.isPending ? 'Restoring…' : `Confirm restore of ${label}`}
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
                {selected ? (
                  <div aria-label={`Contents of ${label}`} role="region">
                    {previewHost === undefined ? comparison : null}
                    {previewBody === null ? null : (
                      <details className={styles.original}>
                        <summary>Stored version content</summary>
                        <DocumentBodyEditor
                          key={version.id}
                          initialContent={previewBody}
                          editable={false}
                          onChange={() => undefined}
                          label={`Text of ${label}`}
                        />
                      </details>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className={styles.safety}>
        Restoring creates a new revision. Nothing is deleted, and later versions remain in
        the history.
      </p>
      {previewHost === undefined ? null : createPortal(comparison, previewHost)}
    </>
  );
  return expanded === undefined ? (
    <details
      className={styles.history}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Version history</summary>
      {contents}
    </details>
  ) : (
    <section className={styles.history} aria-label="Version history">
      <h2>Version history</h2>
      {contents}
    </section>
  );
}
