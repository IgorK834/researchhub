import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { useArchiveWorkspace } from '../api/useWorkspaces';

interface ArchiveWorkspaceButtonProps {
  readonly workspaceId: string;
}

/**
 * Archives a workspace, after asking.
 *
 * Confirmation is a second button rather than `window.confirm`: a native dialog blocks the thread, cannot
 * be styled or described to a screen reader, and is not implemented in jsdom, so it could not be tested.
 * The two-step version is ordinary markup, and the wording is the useful part — it says what archiving
 * does and, just as importantly, what it does not do.
 *
 * On success the user goes back to the list, where the workspace is no longer shown. Rendered only for an
 * owner; the server enforces that independently.
 */
export function ArchiveWorkspaceButton({
  workspaceId,
}: ArchiveWorkspaceButtonProps): ReactElement {
  const navigate = useNavigate();
  const { mutate, isPending, error } = useArchiveWorkspace(workspaceId);

  const [confirming, setConfirming] = useState(false);

  const archive = (): void => {
    mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        void navigate('/app/workspaces');
      },
    });
  };

  return (
    <section aria-labelledby="archive-workspace-heading">
      <h2 id="archive-workspace-heading">Archive</h2>

      {error !== null ? <p role="alert">{describeError(error)}</p> : null}

      {confirming ? (
        <>
          <p>
            Archive this workspace? It will disappear from your workspace list. Nothing is
            deleted — members keep their access and the workspace stays open by its link.
          </p>
          <button type="button" onClick={archive} disabled={isPending}>
            {isPending ? 'Archiving…' : 'Confirm archive'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={isPending}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Archive workspace
        </button>
      )}
    </section>
  );
}
