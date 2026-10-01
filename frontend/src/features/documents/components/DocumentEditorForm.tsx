import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import type { WorkspaceDocument } from '../api/documentApi';
import {
  EMPTY_DOCUMENT,
  readStoredDocument,
  type ProseMirrorDocument,
} from '../api/documentContent';
import { useArchiveDocument } from '../api/useDocuments';
import { useDocumentAutosave } from '../autosave/useDocumentAutosave';
import { DocumentBodyEditor, type AuthoringSelection } from './DocumentBodyEditor';
import { AuthoringPanel } from '../../ai/components/AuthoringPanel';
import { DocumentHistory } from './DocumentHistory';
import { SaveStatus } from './SaveStatus';

interface DocumentEditorFormProps {
  readonly workspaceId: string;
  readonly document: WorkspaceDocument;
  /**
   * Whether to offer editing, saving, restoring, and archiving.
   *
   * Presentation only. The caller passes `true` for a member who may edit content in an active workspace, and
   * the server checks `EDIT_CONTENT` on every request anyway — a forged save still gets `403`, and one to an
   * archived workspace still gets `409`.
   */
  readonly canEdit: boolean;
  /** Reloads the document and discards local edits. Offered only after a conflict. */
  readonly onDiscardLocalChanges: () => void;
  /** The stored document was replaced by a restore; the caller shows the new one in a fresh editor. */
  readonly onReplaced: (document: WorkspaceDocument) => void;
}

/**
 * The document itself: its title, its body, whether they are saved, and its history.
 *
 * **Saving is automatic.** Every edit to the title or the body is handed to autosave, which saves after typing
 * pauses and reports `Saving`, `Saved`, `Save failed`, or `Conflict`. "Save version" is still there for a save
 * the user wants to be a restore point. The body is sent as the editor's `getJSON()` — the ProseMirror tree the
 * backend stores, never HTML.
 *
 * **Local state is initialised once per mounted document** and is never replaced by the server's copy. A save's
 * response only advances the revision; a refetch is ignored; a failed save or a conflict leaves the title and
 * the editor exactly as they were. The caller remounts this component, by changing its key, when the user
 * explicitly loads the latest version or restores an old one.
 *
 * There is still one writer at a time. Two people editing the same document are told about each other by a
 * `409` on save, not merged; docs/context.md section 9 describes Yjs as the later replacement for that.
 */
export function DocumentEditorForm({
  workspaceId,
  document,
  canEdit,
  onDiscardLocalChanges,
  onReplaced,
}: DocumentEditorFormProps): ReactElement {
  const navigate = useNavigate();
  const archive = useArchiveDocument(workspaceId, document.id);

  // Checked once, against the editor's schema. Null means the stored body is something this editor cannot open
  // faithfully, and editing it would risk saving an emptied or altered copy over it.
  const [storedBody] = useState(() => readStoredDocument(document.content));
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState<ProseMirrorDocument>(
    () => storedBody ?? EMPTY_DOCUMENT,
  );

  const autosave = useDocumentAutosave(
    workspaceId,
    document.id,
    { title: document.title, content: storedBody ?? EMPTY_DOCUMENT },
    document.revision,
  );

  const [aiBusy, setAiBusy] = useState(false);
  const [selection, setSelection] = useState<AuthoringSelection>({
    from: 1,
    to: 1,
    text: '',
    placementBlock: 1,
  });
  const isArchived = document.archivedAt !== null;
  const authoringAvailable = canEdit && !isArchived && storedBody !== null;
  const editable = authoringAvailable && !aiBusy;

  const fieldErrors =
    autosave.status === 'failed' ? fieldErrorsByName(autosave.error) : {};
  const titleError =
    fieldErrors['title'] ??
    (autosave.blocked && editable ? 'A title is required.' : undefined);
  const contentError = fieldErrors['content'];
  const archiveFailure = archive.error !== null ? describeError(archive.error) : null;

  const settled = autosave.status === 'saved';

  return (
    <>
      <SaveStatus
        state={autosave}
        onRetry={autosave.retry}
        onDiscardLocalChanges={onDiscardLocalChanges}
      />

      {archiveFailure !== null ? <p role="alert">{archiveFailure}</p> : null}

      {storedBody === null ? (
        <p role="alert">
          This document contains content this editor cannot open, so it is not shown and
          cannot be edited here. Nothing has been changed.
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          autosave.saveNow();
        }}
        noValidate
      >
        <p>
          <label htmlFor="document-editor-title">Title</label>
          <input
            id="document-editor-title"
            name="document-editor-title"
            type="text"
            value={title}
            autoComplete="off"
            readOnly={!editable}
            aria-invalid={titleError !== undefined}
            {...(titleError === undefined
              ? {}
              : { 'aria-describedby': 'document-editor-title-error' })}
            onChange={(event) => {
              setTitle(event.target.value);
              autosave.edit({ title: event.target.value, content: body });
            }}
          />
          {titleError === undefined ? null : (
            <span id="document-editor-title-error">{titleError}</span>
          )}
        </p>

        <div>
          <span id="document-editor-text-label">Text</span>
          {storedBody === null ? null : (
            <DocumentBodyEditor
              onOpenCitation={(path) => {
                void navigate(path);
              }}
              initialContent={storedBody}
              editable={editable}
              onSelectionChange={setSelection}
              onChange={(content) => {
                setBody(content);
                autosave.edit({ title, content });
              }}
              labelId="document-editor-text-label"
              {...(contentError === undefined
                ? {}
                : { errorId: 'document-editor-text-error' })}
            />
          )}
          {contentError === undefined ? null : (
            <span id="document-editor-text-error">{contentError}</span>
          )}
        </div>

        {editable ? (
          <p>
            <button
              type="submit"
              disabled={autosave.blocked || autosave.status === 'conflict'}
            >
              Save version
            </button>{' '}
            Changes save automatically. Save a version to keep a restore point you can
            return to.
          </p>
        ) : null}
      </form>

      {authoringAvailable ? (
        <AuthoringPanel
          workspaceId={workspaceId}
          documentId={document.id}
          revision={autosave.revision}
          settled={settled}
          selection={selection}
          blockCount={body.content?.length ?? 0}
          onBusy={setAiBusy}
          onAccepted={onReplaced}
          onReload={onDiscardLocalChanges}
        />
      ) : null}

      <DocumentHistory
        workspaceId={workspaceId}
        documentId={document.id}
        revision={autosave.revision}
        canRestore={editable}
        restoreBlockedReason={
          settled ? null : 'Restoring is available once your changes are saved.'
        }
        onRestored={onReplaced}
      />

      {canEdit && !isArchived ? (
        <p>
          <button
            type="button"
            disabled={archive.isPending || !settled || aiBusy}
            onClick={() => {
              archive.mutate();
            }}
          >
            {archive.isPending ? 'Archiving…' : 'Archive document'}
          </button>
          {settled ? null : ' Archiving is available once your changes are saved.'}
        </p>
      ) : null}
    </>
  );
}
