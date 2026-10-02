import type { ReactElement } from 'react';
import { Panel } from '../../../shared/components/content';
import { RoleBadge } from '../../../shared/components/identity';
import styles from './WorkspaceViews.module.css';

export function RoleInformation(): ReactElement {
  return (
    <Panel title="What each role can do">
      <div className={styles.roleInfo}>
        <div>
          <RoleBadge role="OWNER" />
          <p>
            <strong>Manage workspace and members</strong>
            <br />
            Edit content and archive the workspace.
          </p>
        </div>
        <div>
          <RoleBadge role="EDITOR" />
          <p>
            <strong>Create and edit content</strong>
            <br />
            Upload sources. Workspace settings are read-only.
          </p>
        </div>
        <div>
          <RoleBadge role="VIEWER" />
          <p>
            <strong>Read workspace content</strong>
            <br />
            Ask AI about sources. Editing controls are hidden.
          </p>
        </div>
      </div>
    </Panel>
  );
}
