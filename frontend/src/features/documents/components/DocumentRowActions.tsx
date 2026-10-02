import { useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  describeError,
  fieldErrorsByName,
  hasApiErrorCode,
  type ApiError,
} from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { Dialog } from '../../../shared/components/overlays';
import {
  fetchDocument,
  type DocumentSummary,
  type WorkspaceDocument,
} from '../api/documentApi';
import { readStoredDocument } from '../api/documentContent';
import { useArchiveDocument, useSaveDocument } from '../api/useDocuments';
import styles from './Documents.module.css';
class UnsupportedDocumentContentError extends Error {}

export function DocumentRowActions({
  workspaceId,
  document,
}: {
  readonly workspaceId: string;
  readonly document: DocumentSummary;
}): ReactElement {
  const [action, setAction] = useState<'rename' | 'archive' | null>(null);
  const [title, setTitle] = useState(document.title);
  const save = useSaveDocument(workspaceId, document.id);
  const archive = useArchiveDocument(workspaceId, document.id);
  const rename = useMutation<WorkspaceDocument, ApiError | Error, string>({
    mutationFn: async (newTitle) => {
      const latest = await fetchDocument(workspaceId, document.id);
      const content = readStoredDocument(latest.content);
      if (content === null)
        throw new UnsupportedDocumentContentError(
          'This document contains content this editor cannot open. Its title has not been changed.',
        );
      // Parsing is a safety check; preserve the original body and all provenance metadata.
      return save({
        title: newTitle,
        content: latest.content as typeof content,
        revision: latest.revision,
        saveKind: 'MANUAL',
      });
    },
    onSuccess: () => setAction(null),
  });
  const pending = rename.isPending || archive.isPending;
  const error = action === 'rename' ? rename.error : archive.error;
  const fieldErrors = fieldErrorsByName(error);
  return (
    <>
      <Button
        variant="ghost"
        size="compact"
        icon="pencil"
        aria-label={`Rename ${document.title}`}
        onClick={() => {
          rename.reset();
          setTitle(document.title);
          setAction('rename');
        }}
      >
        Rename
      </Button>
      <Button
        variant="ghost"
        size="compact"
        icon="archive"
        aria-label={`Archive ${document.title}`}
        onClick={() => {
          archive.reset();
          setAction('archive');
        }}
      >
        Archive
      </Button>
      <Dialog
        open={action !== null}
        title={action === 'rename' ? 'Rename document' : 'Archive document'}
        onClose={() => setAction(null)}
        closeDisabled={pending}
        dismissible={!pending}
      >
        {error !== null ? (
          <p role="alert">
            {hasApiErrorCode(error, 'CONFLICT')
              ? 'The document changed before this action completed. Please try again.'
              : error instanceof UnsupportedDocumentContentError
                ? error.message
                : describeError(error)}
          </p>
        ) : null}
        {action === 'rename' ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate(title);
            }}
            noValidate
          >
            <TextField
              label="Document title"
              value={title}
              error={fieldErrors['title']}
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button
              type="submit"
              disabled={!title.trim()}
              busy={pending}
              busyLabel="Renaming…"
            >
              Rename document
            </Button>
          </form>
        ) : (
          <>
            <p>
              Archive “{document.title}”? It leaves this list, and its text stays
              available through its existing link.
            </p>
            <Button
              variant="danger"
              busy={pending}
              busyLabel="Archiving…"
              onClick={() =>
                archive.mutate(undefined, { onSuccess: () => setAction(null) })
              }
            >
              Archive document
            </Button>
          </>
        )}
      </Dialog>
    </>
  );
}
