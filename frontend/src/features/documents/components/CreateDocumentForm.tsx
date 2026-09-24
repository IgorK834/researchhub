import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { toProseMirrorDocument } from '../api/documentContent';
import { useCreateDocument } from '../api/useDocuments';

interface CreateDocumentFormProps {
  readonly workspaceId: string;
}

/**
 * Starts a new document with a title and an empty body.
 *
 * Only a title is asked for: the text is written on the document's own page, and a create form that also
 * collected the body would be a second editor to keep in step with the first. The content sent is one empty
 * paragraph, which is what an editor needs in order to have somewhere to put a cursor.
 *
 * Rendered only for a member who may edit content, and only while the workspace is active. The server checks
 * `EDIT_CONTENT` on the request regardless, and answers `403` to a viewer.
 */
export function CreateDocumentForm({
  workspaceId,
}: CreateDocumentFormProps): ReactElement {
  const { mutate, isPending, error } = useCreateDocument(workspaceId);

  const [title, setTitle] = useState('');

  const fieldErrors = fieldErrorsByName(error);
  const titleError = fieldErrors['title'];
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    mutate(
      { title, content: toProseMirrorDocument('') },
      {
        onSuccess: () => {
          setTitle('');
        },
      },
    );
  };

  return (
    <section aria-labelledby="create-document-heading">
      <h2 id="create-document-heading">New document</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <p>
          <label htmlFor="document-title">Document title</label>
          <input
            id="document-title"
            name="document-title"
            type="text"
            value={title}
            autoComplete="off"
            aria-invalid={titleError !== undefined}
            {...(titleError === undefined
              ? {}
              : { 'aria-describedby': 'document-title-error' })}
            onChange={(event) => setTitle(event.target.value)}
          />
          {titleError === undefined ? null : (
            <span id="document-title-error">{titleError}</span>
          )}
        </p>

        <button type="submit" disabled={isPending}>
          {isPending ? 'Creating…' : 'Create document'}
        </button>
      </form>
    </section>
  );
}
