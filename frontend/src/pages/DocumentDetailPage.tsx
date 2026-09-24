import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useDocumentQuery } from '../features/documents/api/useDocuments';
import { DocumentEditorForm } from '../features/documents/components/DocumentEditorForm';
import { useWorkspaceQuery } from '../features/workspaces/api/useWorkspaces';
import { describeError, hasApiErrorCode } from '../shared/api';

/**
 * One document: its title, its text, and the controls for changing them.
 *
 * Composes two features — the document itself and the workspace whose role decides what may be shown. That
 * composition belongs in a page: a feature must not import another feature, and neither of them should have to
 * know about the other to be useful.
 *
 * Renders inside the protected `/app` shell, so there is always a signed-in user by the time this mounts.
 */
export function DocumentDetailPage(): ReactElement {
  const { workspaceId, documentId } = useParams<{
    workspaceId: string;
    documentId: string;
  }>();

  // The route always supplies both, so this is unreachable in the app. Handled anyway, and handled before any
  // data hook runs, so the ids passed down are definite strings.
  if (workspaceId === undefined || documentId === undefined) {
    return <DocumentNotFound workspaceId={workspaceId} />;
  }
  return <DocumentScreen workspaceId={workspaceId} documentId={documentId} />;
}

/**
 * What a caller sees when the server says `404`.
 *
 * Says nothing about whether the document exists. The server answers "no such document", "not your workspace",
 * and "that document belongs to a different workspace" identically, so a page that guessed between them would
 * hand back exactly what the backend withheld.
 */
function DocumentNotFound({
  workspaceId,
}: {
  readonly workspaceId: string | undefined;
}): ReactElement {
  return (
    <section>
      <h1>Document not found</h1>
      <p>
        This document is not available. It may have been removed, or you may not have
        access.
      </p>
      <p>
        <Link
          to={
            workspaceId === undefined
              ? '/app/workspaces'
              : `/app/workspaces/${workspaceId}`
          }
        >
          Back to the workspace
        </Link>
      </p>
    </section>
  );
}

function DocumentScreen({
  workspaceId,
  documentId,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
}): ReactElement {
  const document = useDocumentQuery(workspaceId, documentId);
  // The caller's role, for deciding what to render. Usually already cached from the workspace page.
  const workspace = useWorkspaceQuery(workspaceId);

  // Bumped when the user asks for the latest version after a conflict. It is part of the editor's key, so the
  // editor remounts and re-reads the refetched document instead of keeping the text that failed to save.
  const [reloadCount, setReloadCount] = useState(0);

  if (document.isPending) {
    return (
      <section>
        <p role="status" aria-live="polite">
          Loading this document…
        </p>
      </section>
    );
  }

  if (document.error !== null) {
    if (hasApiErrorCode(document.error, 'RESOURCE_NOT_FOUND')) {
      return <DocumentNotFound workspaceId={workspaceId} />;
    }
    return (
      <section>
        <h1>Document</h1>
        <p role="alert">Could not load this document: {describeError(document.error)}</p>
      </section>
    );
  }

  const role = workspace.data?.role;
  const workspaceArchived =
    workspace.data?.archivedAt !== null && workspace.data !== undefined;
  // A viewer may read and nothing else. Until the role is known, assume the narrower answer rather than
  // rendering controls that would turn into a 403.
  const canEdit = (role === 'OWNER' || role === 'EDITOR') && !workspaceArchived;
  const isArchived = document.data.archivedAt !== null;

  const discardLocalChanges = (): void => {
    void document.refetch().then(() => {
      setReloadCount((count) => count + 1);
    });
  };

  return (
    <section>
      <h1>{document.data.title}</h1>

      {isArchived ? (
        <p role="status">
          This document is archived. It no longer appears in the workspace&apos;s document
          list and can no longer be changed. Its text has not been deleted.
        </p>
      ) : null}

      <DocumentEditorForm
        key={`${document.data.id}-${reloadCount}`}
        workspaceId={workspaceId}
        document={document.data}
        canEdit={canEdit}
        onDiscardLocalChanges={discardLocalChanges}
      />

      <p>
        <Link to={`/app/workspaces/${workspaceId}`}>Back to the workspace</Link>
      </p>
    </section>
  );
}
