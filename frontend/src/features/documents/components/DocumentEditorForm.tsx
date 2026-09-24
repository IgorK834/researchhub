import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName, hasApiErrorCode } from '../../../shared/api';
import { toPlainText, toProseMirrorDocument } from '../api/documentContent';
import type { WorkspaceDocument } from '../api/documentApi';
import { useArchiveDocument, useUpdateDocument } from '../api/useDocuments';

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
 * The document itself: a title, a textarea, and the revision they belong to.
 *
 * A plain textarea, not an editor framework. docs/context.md section 9 describes a Tiptap and Yjs editor as a
 * later stage; what this pass proves is that a document survives a reload, which needs storage and a revision
 * rather than a rich-text surface. The text is the paragraph text inside the stored JSON — never HTML, in either
 * direction.
 *
 * <strong>Local state is initialised once per mounted document</strong>, from the props, and is not resynced when
 * the query refetches. That is deliberate: silently replacing what somebody is typing with a newer server copy is
 * the failure this whole revision mechanism exists to avoid. The caller remounts this component, by changing its
 * key, when the user explicitly asks for the latest version.
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
  const [text, setText] = useState(() => toPlainText(document.content));
  // The revision the text on screen is based on. It advances only on a successful save, so a refused one leaves
  // the editor holding the same stale value and the next attempt fails the same way — until the user reloads.
  const [revision, setRevision] = useState(document.revision);
  const [saved, setSaved] = useState(false);

  const isArchived = document.archivedAt !== null;

  const fieldErrors = fieldErrorsByName(save.error);
  const titleError = fieldErrors['title'];
  const contentError = fieldErrors['content'];

  const conflict = hasApiErrorCode(save.error, 'CONFLICT');
  const failure =
    save.error !== null && Object.keys(fieldErrors).length === 0
      ? describeError(save.error)
      : null;
  const archiveFailure = archive.error !== null ? describeError(archive.error) : null;

  const submit = (): void => {
    setSaved(false);
    save.mutate(
      { title, content: toProseMirrorDocument(text), revision },
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
            readOnly={!canEdit}
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

        <p>
          <label htmlFor="document-editor-text">Text</label>
          <textarea
            id="document-editor-text"
            name="document-editor-text"
            value={text}
            rows={20}
            readOnly={!canEdit}
            aria-invalid={contentError !== undefined}
            {...(contentError === undefined
              ? {}
              : { 'aria-describedby': 'document-editor-text-error' })}
            onChange={(event) => setText(event.target.value)}
          />
          {contentError === undefined ? null : (
            <span id="document-editor-text-error">{contentError}</span>
          )}
        </p>

        <p>Revision {revision}</p>

        {canEdit && !isArchived ? (
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
