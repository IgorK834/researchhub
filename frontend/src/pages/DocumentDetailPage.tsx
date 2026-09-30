import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ResearchPanel } from '../features/ai/components/ResearchPanel';
import { useSourcesQuery } from '../features/sources/api/useSources';

import { useDocumentQuery } from '../features/documents/api/useDocuments';
import { CreateDocumentForm } from '../features/documents/components/CreateDocumentForm';
import { DocumentEditorForm } from '../features/documents/components/DocumentEditorForm';
import { DocumentList } from '../features/documents/components/DocumentList';
import { useWorkspaceQuery } from '../features/workspaces/api/useWorkspaces';
import { describeError, hasApiErrorCode } from '../shared/api';

/**
 * The workspace's writing shell: its documents down the side, one of them open in the editor.
 *
 * The side lists every document in the workspace, with the open one marked, and — for an editor or owner — a
 * form that creates a document and opens it. The editor area holds the title, the body, the save status, and
 * the version history. What is offered follows the caller's role; the server re-checks every request.
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
  const sources = useSourcesQuery(workspaceId);
  const navigate = useNavigate();

  // Bumped when the stored document replaces what the editor holds: the user asked for the latest version after
  // a conflict, or restored an old one. It is part of the editor's key, so the editor remounts and reads the new
  // document instead of keeping its own.
  const [reloadCount, setReloadCount] = useState(0);

  if (document.error !== null && hasApiErrorCode(document.error, 'RESOURCE_NOT_FOUND')) {
    return <DocumentNotFound workspaceId={workspaceId} />;
  }

  const role = workspace.data?.role;
  const workspaceArchived =
    workspace.data?.archivedAt !== null && workspace.data !== undefined;
  // A viewer may read and nothing else. Until the role is known, assume the narrower answer rather than
  // rendering controls that would turn into a 403.
  const canEdit = (role === 'OWNER' || role === 'EDITOR') && !workspaceArchived;

  const openDocument = (id: string): void => {
    void navigate(`/app/workspaces/${workspaceId}/documents/${id}`);
  };

  return (
    <div style={SHELL_STYLE}>
      <nav aria-label="Workspace documents" style={SIDEBAR_STYLE}>
        <p>
          <Link to={`/app/workspaces/${workspaceId}`}>Back to the workspace</Link>
          {workspace.data === undefined ? null : <> · {workspace.data.name}</>}
        </p>
        <DocumentList workspaceId={workspaceId} currentDocumentId={documentId} />
        {canEdit ? (
          <CreateDocumentForm
            workspaceId={workspaceId}
            onCreated={(created) => {
              openDocument(created.id);
            }}
          />
        ) : null}
      </nav>

      <section aria-label="Editor" style={EDITOR_STYLE}>
        <EditorArea
          workspaceId={workspaceId}
          document={document}
          canEdit={canEdit}
          reloadCount={reloadCount}
          onReload={() => {
            setReloadCount((count) => count + 1);
          }}
        />
      </section>
      {document.data !== undefined && workspace.data !== undefined ? (
        <aside
          aria-label="Research alongside the document"
          style={{ flex: '0 1 24rem', minWidth: '18rem', maxWidth: '100%' }}
        >
          <ResearchPanel
            workspaceId={workspaceId}
            sources={{
              sources:
                sources.data?.map((source) => ({
                  id: source.id,
                  title: source.displayName,
                  ready: source.status === 'READY',
                })) ?? [],
              loading: sources.isPending,
              error:
                sources.error === null
                  ? null
                  : `Could not load research sources: ${describeError(sources.error)}`,
            }}
          />
        </aside>
      ) : null}
    </div>
  );
}

function EditorArea({
  workspaceId,
  document,
  canEdit,
  reloadCount,
  onReload,
}: {
  readonly workspaceId: string;
  readonly document: ReturnType<typeof useDocumentQuery>;
  readonly canEdit: boolean;
  readonly reloadCount: number;
  readonly onReload: () => void;
}): ReactElement {
  if (document.isPending) {
    return (
      <p role="status" aria-live="polite">
        Loading this document…
      </p>
    );
  }

  if (document.error !== null) {
    return (
      <>
        <h1>Document</h1>
        <p role="alert">Could not load this document: {describeError(document.error)}</p>
      </>
    );
  }

  const isArchived = document.data.archivedAt !== null;

  return (
    <>
      <h1>{document.data.title}</h1>

      {isArchived ? (
        <p role="status">
          This document is archived. It no longer appears in the workspace&apos;s document
          list and can no longer be changed. Its text has not been deleted.
        </p>
      ) : null}

      <DocumentEditorForm
        key={`${document.data.id}-${String(reloadCount)}`}
        workspaceId={workspaceId}
        document={document.data}
        canEdit={canEdit}
        onDiscardLocalChanges={() => {
          void document.refetch().then(onReload);
        }}
        // The restore already wrote the new document into the cache, so there is nothing to refetch.
        onReplaced={onReload}
      />
    </>
  );
}

/**
 * Two columns that wrap into one on a narrow screen. Inline because the app has no stylesheet yet, and one
 * layout rule is not worth introducing one for.
 */
const SHELL_STYLE = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2rem',
  alignItems: 'flex-start',
} as const;
const SIDEBAR_STYLE = { flex: '0 1 16rem', minWidth: '12rem' } as const;
const EDITOR_STYLE = { flex: '1 1 32rem', minWidth: 0 } as const;
