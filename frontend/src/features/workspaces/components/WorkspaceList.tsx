import type { ReactElement } from 'react';

import type { Workspace } from '../api/workspaceApi';
import { WorkspaceCard } from './WorkspaceCard';
import styles from './Workspaces.module.css';

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
  return (
    <ul className={styles.grid} aria-label="Your workspaces">
      {workspaces.map((workspace) => (
        <li key={workspace.id}>
          <WorkspaceCard workspace={workspace} />
        </li>
      ))}
    </ul>
  );
}
