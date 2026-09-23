import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import type { Workspace } from '../api/workspaceApi';

interface WorkspaceListProps {
  readonly workspaces: readonly Workspace[];
}

/**
 * The workspaces the signed-in user belongs to.
 *
 * Every entry here is one the server already decided this user may see, because the list endpoint is
 * built from their memberships. Nothing is filtered client-side.
 *
 * The role shown next to each workspace is informational. It tells the user what they are in this
 * workspace; it is not a permission check, and hiding a control based on it would not be one either —
 * every mutating operation is authorized again on the server
 * (`WorkspaceAuthorizationService`).
 */
export function WorkspaceList({ workspaces }: WorkspaceListProps): ReactElement {
  if (workspaces.length === 0) {
    return <p>You do not belong to any workspace yet. Create one to get started.</p>;
  }

  return (
    <ul>
      {workspaces.map((workspace) => (
        <li key={workspace.id}>
          <Link to={`/app/workspaces/${workspace.id}`}>{workspace.name}</Link>
          <span> — {workspace.role}</span>
          {workspace.description === null ? null : <p>{workspace.description}</p>}
        </li>
      ))}
    </ul>
  );
}
