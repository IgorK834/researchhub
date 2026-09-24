import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useWorkspaceQuery } from '../features/workspaces/api/useWorkspaces';
import { AddMemberForm } from '../features/workspaces/components/AddMemberForm';
import { ArchiveWorkspaceButton } from '../features/workspaces/components/ArchiveWorkspaceButton';
import { EditWorkspaceForm } from '../features/workspaces/components/EditWorkspaceForm';
import { MemberList } from '../features/workspaces/components/MemberList';
import { describeError, hasApiErrorCode } from '../shared/api';

/**
 * One workspace: its metadata, the caller's role in it, and the owner's controls.
 *
 * Renders inside the protected `/app` shell, so there is always a signed-in user by the time this mounts.
 */
export function WorkspaceDetailPage(): ReactElement {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  // The route always supplies the parameter, so this is unreachable in the app. Handled anyway, and
  // handled before any data hook runs, so the id passed down below is a definite string.
  if (workspaceId === undefined) {
    return <WorkspaceNotFound />;
  }
  return <WorkspaceDetail workspaceId={workspaceId} />;
}

/**
 * What a caller sees when the server says `404`.
 *
 * Deliberately says nothing about whether the workspace exists. The server answers "no such workspace"
 * and "not yours" identically so that an id cannot be probed for existence, and a page that rendered a
 * more helpful message for one of the two cases would hand back exactly the information the backend just
 * withheld.
 */
function WorkspaceNotFound(): ReactElement {
  return (
    <section>
      <h1>Workspace not found</h1>
      <p>
        This workspace is not available. It may have been removed, or you may not have
        access.
      </p>
      <p>
        <Link to="/app/workspaces">Back to your workspaces</Link>
      </p>
    </section>
  );
}

function WorkspaceDetail({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  const { data: workspace, error, isPending } = useWorkspaceQuery(workspaceId);

  if (isPending) {
    return (
      <section>
        <p role="status" aria-live="polite">
          Loading this workspace…
        </p>
      </section>
    );
  }

  if (error !== null) {
    if (hasApiErrorCode(error, 'RESOURCE_NOT_FOUND')) {
      return <WorkspaceNotFound />;
    }
    return (
      <section>
        <h1>Workspace</h1>
        <p role="alert">Could not load this workspace: {describeError(error)}</p>
      </section>
    );
  }

  const isArchived = workspace.archivedAt !== null;

  // One flag for every owner-only control, so a new one cannot accidentally be shown on an archived
  // workspace. It decides what to render and nothing else: the server authorizes each request itself.
  const canManage = workspace.role === 'OWNER' && !isArchived;

  return (
    <section>
      <h1>{workspace.name}</h1>

      <p>
        Your role: <strong>{workspace.role}</strong>
      </p>

      {isArchived ? (
        <p role="status">
          This workspace is archived. It no longer appears in your workspace list, and its
          content can no longer be changed. Nothing has been deleted.
        </p>
      ) : null}

      {workspace.description === null ? (
        <p>No description.</p>
      ) : (
        <p>{workspace.description}</p>
      )}

      {/* Every member sees who else is here. Only an owner of an active workspace gets the controls, and
          the server re-checks that on every request. */}
      <MemberList workspaceId={workspace.id} canManage={canManage} />

      {/* Owner-only, and only while the workspace is active. Both conditions are re-checked by the
          server, which answers 403 to a non-owner and 409 on an archived workspace. */}
      {canManage ? (
        <>
          <AddMemberForm workspaceId={workspace.id} />
          <EditWorkspaceForm workspace={workspace} />
          <ArchiveWorkspaceButton workspaceId={workspace.id} />
        </>
      ) : null}

      <p>
        <Link to="/app/workspaces">Back to your workspaces</Link>
      </p>
    </section>
  );
}
