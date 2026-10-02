import { useId, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Card } from '../../../shared/components/content';
import { RoleBadge } from '../../../shared/components/identity';
import type { Workspace } from '../api/workspaceApi';
import styles from './Workspaces.module.css';

type WorkspaceCardProps =
  | { readonly workspace: Workspace; readonly preview?: false }
  | {
      readonly preview: true;
      readonly name: string;
      readonly description: string;
    };

/** The preview uses the same card chrome, without inventing stored accent, counts or people. */
export function WorkspaceCard(props: WorkspaceCardProps): ReactElement {
  const id = useId();
  const preview = props.preview === true;
  const name = preview ? props.name.trim() || 'Workspace name' : props.workspace.name;
  const description = preview ? props.description.trim() : props.workspace.description;
  return (
    <Card className={styles.workspaceCard} role="article" aria-labelledby={id}>
      <h3 id={id}>
        {preview ? (
          name
        ) : (
          <Link to={`/app/workspaces/${props.workspace.id}`}>{name}</Link>
        )}
      </h3>
      {description ? <p className={styles.description}>{description}</p> : null}
      <div className={styles.cardFooter}>
        <div className={styles.role}>
          {preview ? <span>You · </span> : null}
          <RoleBadge role={preview ? 'OWNER' : props.workspace.role} />
        </div>
        {preview ? null : (
          <span className={styles.updated}>
            Updated{' '}
            <time dateTime={props.workspace.updatedAt}>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(props.workspace.updatedAt))}
            </time>
          </span>
        )}
      </div>
    </Card>
  );
}
