import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';

export function WorkspaceDetailPage(): ReactElement {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <section>
      <h1>Workspace {workspaceId}</h1>
      <p>Placeholder — workspace detail is not implemented yet.</p>
    </section>
  );
}
