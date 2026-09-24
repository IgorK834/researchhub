import { useState, type ReactElement } from 'react';

import {
  describeError,
  fieldErrorsByName,
  hasApiErrorCode,
  isApiError,
} from '../../../shared/api';
import {
  EMPTY_DOCUMENT,
  readStoredDocument,
  type ProseMirrorDocument,
} from '../api/documentContent';
import type { WorkspaceDocument } from '../api/documentApi';
import { useArchiveDocument, useUpdateDocument } from '../api/useDocuments';
import { DocumentBodyEditor } from './DocumentBodyEditor';

interface DocumentEditorFormProps {
  readonly workspaceId: string;
  readonly document: WorkspaceDocument;
  /**
   * Whether to render the save and archive controls.
   *
   * Presentation only. The caller passes `true` for a member who may edit content in an active workspace, and
   * the server checks `EDIT_CONTENT` on every request anyway — a forged save still gets `403`, and one to an
   * archived workspace still gets `409`.
   */
  readonly canEdit: boolean;
  /** Reloads the document and discards local edits. Offered only after a conflict. */
  readonly onDiscardLocalChanges: () => void;
}

/**
 * The document itself: a title, the body in a Tiptap editor, and the revision they belong to.
 *
 * The body is saved as the editor's `getJSON()` — the ProseMirror tree the backend stores, never HTML. The title
 * stays a plain input outside the editor, because it is its own column.
 *
 * <strong>Local state is initialised once per mounted document</strong>, from the props, and is not resynced when
 * the query refetches. That is deliberate: silently replacing what somebody is typing with a newer server copy is
 * the failure this whole revision mechanism exists to avoid. A refused save — a conflict included — leaves the
 * title, the editor's document, and the revision exactly as they were. The caller remounts this component, by
 * changing its key, when the user explicitly asks for the latest version.
 *
 * There is still one writer at a time. Two people editing the same document are told about each other by a
 * `409` on save, not merged; docs/context.md section 9 describes Yjs as the later replacement for that.
 */
export function DocumentEditorForm({
  workspaceId,
  document,
  canEdit,
  onDiscardLocalChanges,
}: DocumentEditorFormProps): ReactElement {
  const save = useUpdateDocument(workspaceId, document.id);
  const archive = useArchiveDocument(workspaceId, document.id);

  const [title, setTitle] = useState(document.title);
  // Checked once, against the editor's schema. Null means the stored body is something this editor cannot open
  // faithfully, and editing it would risk saving an emptied or altered copy over it.
  const [storedBody] = useState(() => readStoredDocument(document.content));
  // What a save sends: the editor's latest getJSON(). Starts as the stored body, which is the same value.
  const [body, setBody] = useState<ProseMirrorDocument>(
    () => storedBody ?? EMPTY_DOCUMENT,
  );
  // The revision the text on screen is based on. It advances only on a successful save, so a refused one leaves
  // the editor holding the same stale value and the next attempt fails the same way — until the user reloads.
  const [revision, setRevision] = useState(document.revision);
  const [saved, setSaved] = useState(false);

  const isArchived = document.archivedAt !== null;
  const editable = canEdit && !isArchived && storedBody !== null;

  const fieldErrors = fieldErrorsByName(save.error);
  const titleError = fieldErrors['title'];
  const contentError = fieldErrors['content'];

  const conflict = hasApiErrorCode(save.error, 'CONFLICT');
  // Present only when the conflict is a newer revision. An archived document or workspace is also a CONFLICT,
  // and a server that does not send it is handled by the detail alone.
  const currentRevision =
    conflict && isApiError(save.error) ? save.error.problem.currentRevision : undefined;
  const failure =
    save.error !== null && Object.keys(fieldErrors).length === 0
      ? describeError(save.error)
      : null;
  const archiveFailure = archive.error !== null ? describeError(archive.error) : null;

  const submit = (): void => {
    setSaved(false);
    save.mutate(
      { title, content: body, revision },
      {
        onSuccess: (stored) => {
          setRevision(stored.revision);
          setSaved(true);
        },
      },
    );
  };

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {failure !== null ? <p role="alert">{failure}</p> : null}
        {archiveFailure !== null ? <p role="alert">{archiveFailure}</p> : null}
        {saved && save.error === null ? <p>Saved as revision {revision}.</p> : null}

        {storedBody === null ? (
          <p role="alert">
            This document contains content this editor cannot open, so it is not shown and
            cannot be edited here. Nothing has been changed.
          </p>
        ) : null}

        {currentRevision === undefined ? null : (
          <p>
            The saved document is now at revision {currentRevision}. Your copy is based on
            revision {revision}. Your changes are still here and have not been saved.
          </p>
        )}

        {conflict ? (
          <p>
            <button type="button" onClick={onDiscardLocalChanges}>
              Discard my changes and load the latest version
            </button>
          </p>
        ) : null}

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
            onChange={(event) => setTitle(event.target.value)}
          />
          {titleError === undefined ? null : (
            <span id="document-editor-title-error">{titleError}</span>
          )}
        </p>

        <div>
          <span id="document-editor-text-label">Text</span>
          {storedBody === null ? null : (
            <DocumentBodyEditor
              initialContent={storedBody}
              editable={editable}
              onChange={setBody}
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

        <p>Revision {revision}</p>

        {editable ? (
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </form>

      {canEdit && !isArchived ? (
        <button
          type="button"
          disabled={archive.isPending}
          onClick={() => {
            archive.mutate();
          }}
        >
          {archive.isPending ? 'Archiving…' : 'Archive document'}
        </button>
      ) : null}
    </>
  );
}
