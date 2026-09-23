import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { useUpdateWorkspace } from '../api/useWorkspaces';
import type { Workspace } from '../api/workspaceApi';

interface EditWorkspaceFormProps {
  readonly workspace: Workspace;
}

/**
 * Renames a workspace and edits its description.
 *
 * Rendered only for an owner, and only while the workspace is active — but that is presentation. The
 * server checks `MANAGE_WORKSPACE` on every request and answers `403` to an editor or viewer and `409` on
 * an archived workspace, so nothing here is load-bearing for access control.
 *
 * Both fields are sent on every save, because `PATCH` replaces the metadata rather than merging it. The
 * inputs start from the current values, so a user who edits one field is not silently clearing the other.
 */
export function EditWorkspaceForm({ workspace }: EditWorkspaceFormProps): ReactElement {
  const { mutate, isPending, error } = useUpdateWorkspace(workspace.id);

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
    setSaved(false);
    mutate(
      { name, description },
      {
        onSuccess: () => {
          setSaved(true);
        },
      },
    );
  };

  return (
    <section aria-labelledby="edit-workspace-heading">
      <h2 id="edit-workspace-heading">Workspace settings</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}
        {saved && error === null ? <p role="status">Changes saved.</p> : null}

        <p>
          <label htmlFor="edit-workspace-name">Name</label>
          <input
            id="edit-workspace-name"
            name="edit-workspace-name"
            type="text"
            value={name}
            autoComplete="off"
            aria-invalid={nameError !== undefined}
            {...(nameError === undefined
              ? {}
              : { 'aria-describedby': 'edit-workspace-name-error' })}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError === undefined ? null : (
            <span id="edit-workspace-name-error">{nameError}</span>
          )}
        </p>

        <p>
          <label htmlFor="edit-workspace-description">Description</label>
          <textarea
            id="edit-workspace-description"
            name="edit-workspace-description"
            value={description}
            aria-invalid={descriptionError !== undefined}
            {...(descriptionError === undefined
              ? {}
              : { 'aria-describedby': 'edit-workspace-description-error' })}
            onChange={(event) => setDescription(event.target.value)}
          />
          {descriptionError === undefined ? null : (
            <span id="edit-workspace-description-error">{descriptionError}</span>
          )}
        </p>

        <button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </section>
  );
}
