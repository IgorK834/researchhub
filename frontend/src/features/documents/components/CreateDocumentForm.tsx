import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import type { WorkspaceDocument } from '../api/documentApi';
import { EMPTY_DOCUMENT } from '../api/documentContent';
import { useCreateDocument } from '../api/useDocuments';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import styles from './Documents.module.css';

interface CreateDocumentFormProps {
  readonly workspaceId: string;
  /** Called with the new document, so the page can open it. */
  readonly onCreated?: (document: WorkspaceDocument) => void;
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
  onCreated,
}: CreateDocumentFormProps): ReactElement {
  const { mutate, isPending, error } = useCreateDocument(workspaceId);

  const [title, setTitle] = useState('');

  const fieldErrors = fieldErrorsByName(error);
  const titleError = fieldErrors['title'];
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    mutate(
      { title, content: EMPTY_DOCUMENT },
      {
        onSuccess: (created) => {
          setTitle('');
          onCreated?.(created);
        },
      },
    );
  };

  return (
    <section aria-label="New document" id="create-document-heading">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <TextField
          label="Document title"
          id="document-title"
          name="document-title"
          type="text"
          value={title}
          autoComplete="off"
          disabled={isPending}
          error={titleError}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          disabled={!title.trim()}
          busy={isPending}
          busyLabel="Creating…"
        >
          Create document
        </Button>
      </form>
    </section>
  );
}
