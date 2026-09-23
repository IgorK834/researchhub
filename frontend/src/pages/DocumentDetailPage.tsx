import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function DocumentDetailPage(): ReactElement {
  const { workspaceId, documentId } = useParams<{
    workspaceId: string;
    documentId: string;
  }>();

  return (
    <section>
      <h1>Document {documentId}</h1>
      <p>Workspace {workspaceId}</p>
      <p>Placeholder — document editor is not implemented yet.</p>
    </section>
  );
}
