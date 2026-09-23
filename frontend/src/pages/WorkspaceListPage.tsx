import type { ReactElement } from 'react';

import { useWorkspacesQuery } from '../features/workspaces/api/useWorkspaces';
import { CreateWorkspaceForm } from '../features/workspaces/components/CreateWorkspaceForm';
import { WorkspaceList } from '../features/workspaces/components/WorkspaceList';
import { describeError } from '../shared/api';

/**
 * The signed-in user's workspaces, and the form for adding one.
 *
 * Renders inside the protected `/app` shell, so there is always a user by the time this mounts and the
 * page does not repeat the session check.
 *
 * The page owns the loading, error, and success branches; the feature owns the transport and the query
 * key. An empty list is a success, not an error — it is what a new account correctly sees.
 */
export function WorkspaceListPage(): ReactElement {
  const { data, error, isPending } = useWorkspacesQuery();

  return (
    <section>
      <h1>Workspaces</h1>

      {isPending ? (
        <p role="status" aria-live="polite">
          Loading your workspaces…
        </p>
      ) : null}

      {error !== null && !isPending ? (
        <p role="alert">Could not load your workspaces: {describeError(error)}</p>
      ) : null}

      {data !== undefined && error === null ? <WorkspaceList workspaces={data} /> : null}

      <CreateWorkspaceForm />
    </section>
  );
}
