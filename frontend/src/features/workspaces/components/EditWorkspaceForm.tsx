import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { TextField, Textarea } from '../../../shared/components/forms';
import { useUpdateWorkspace } from '../api/useWorkspaces';
import type { Workspace } from '../api/workspaceApi';
import { Button } from '../../../shared/components/Button';
import { Panel } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import styles from './WorkspaceViews.module.css';

interface EditWorkspaceFormProps {
  readonly workspace: Workspace;
  readonly readOnly?: boolean;
}

/**
 * Renames a workspace and edits its description.
 *
 * Editable only for an owner while the workspace is active; `readOnly` renders General metadata. The
 * server checks `MANAGE_WORKSPACE` on every request and answers `403` to an editor or viewer and `409` on
 * an archived workspace, so nothing here is load-bearing for access control.
 *
 * Both fields are sent on every save, because `PATCH` replaces the metadata rather than merging it. The
 * inputs start from the current values, so a user who edits one field is not silently clearing the other.
 */
export function EditWorkspaceForm({
  workspace,
  readOnly = false,
}: EditWorkspaceFormProps): ReactElement {
  const { mutate, isPending, error, reset } = useUpdateWorkspace(workspace.id);

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [saved, setSaved] = useState(false);

  const fieldErrors = fieldErrorsByName(error);
  const nameError = fieldErrors['name'];
  const descriptionError = fieldErrors['description'];

  // A refused role (403) or an archived workspace (409) is one message about the request as a whole, not
  // a problem with a particular input.
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    if (isPending || readOnly) return;
    setSaved(false);
    mutate(
      { name, description },
      {
        onSuccess: (updated) => {
          setName(updated.name);
          setDescription(updated.description ?? '');
          setSaved(true);
        },
      },
    );
  };

  return (
    <div id="edit-workspace-heading">
      <Panel title="General">
        <p>Everyone in the workspace sees this name and description.</p>
        {readOnly ? (
          <>
            <p>
              Workspace settings are read-only. Only an owner of an active workspace can
              change them.
            </p>
            <dl className={styles.readOnly}>
              <dt>Name</dt>
              <dd>{workspace.name}</dd>
              <dt>Description</dt>
              <dd>{workspace.description ?? 'No description.'}</dd>
            </dl>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            noValidate
          >
            {formMessage !== null ? <Banner tone="error" lead={formMessage} /> : null}
            {saved && error === null ? <p role="status">Changes saved.</p> : null}

            <TextField
              id="edit-workspace-name"
              name="edit-workspace-name"
              label="Name"
              type="text"
              autoComplete="off"
              value={name}
              disabled={isPending}
              error={nameError}
              onChange={(event) => {
                setSaved(false);
                setName(event.target.value);
              }}
            />

            <Textarea
              id="edit-workspace-description"
              name="edit-workspace-description"
              label="Description"
              value={description}
              disabled={isPending}
              error={descriptionError}
              onChange={(event) => {
                setSaved(false);
                setDescription(event.target.value);
              }}
            />

            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() => {
                  setName(workspace.name);
                  setDescription(workspace.description ?? '');
                  setSaved(false);
                  reset();
                }}
              >
                Discard
              </Button>
              <Button
                type="submit"
                busy={isPending}
                busyLabel="Saving…"
                aria-label={isPending ? 'Saving…' : undefined}
              >
                Save changes
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </div>
  );
}
