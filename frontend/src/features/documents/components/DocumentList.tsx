import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { useDocumentsQuery } from '../api/useDocuments';

interface DocumentListProps {
  readonly workspaceId: string;
}

/**
 * The workspace's documents, as links.
 *
 * Every member sees this, because reading is what `VIEW_CONTENT` is. Archived documents are absent — the server
 * leaves them out of the list — though they remain reachable by their URL, so a link somebody saved still works.
 *
 * Titles only. The list endpoint returns no content, so there is nothing here to preview and nothing to
 * accidentally render.
 */
export function DocumentList({ workspaceId }: DocumentListProps): ReactElement {
  const { data: documents, error, isPending } = useDocumentsQuery(workspaceId);

  return (
    <section aria-labelledby="workspace-documents-heading">
      <h2 id="workspace-documents-heading">Documents</h2>

      {isPending ? (
        <p role="status" aria-live="polite">
          Loading documents…
        </p>
      ) : null}

      {error !== null && !isPending ? (
        <p role="alert">Could not load the documents: {describeError(error)}</p>
      ) : null}

      {documents !== undefined && error === null ? (
        documents.length === 0 ? (
          <p>No documents yet.</p>
        ) : (
          <ul>
            {documents.map((document) => (
              <li key={document.id}>
                <Link to={`/app/workspaces/${workspaceId}/documents/${document.id}`}>
                  {document.title}
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
