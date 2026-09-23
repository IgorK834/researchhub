import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { useCreateWorkspace } from '../api/useWorkspaces';

/**
 * Form for creating a workspace.
 *
 * Validation messages come from the server's ProblemDetail `errors` array rather than being duplicated
 * here, so the field limits cannot drift from the backend's. The submitted name is cleared on success,
 * which is also when the list behind this form refetches.
 *
 * Fields are written out rather than reusing `features/auth`'s `FormField`: one feature must not import
 * from another (docs/development/frontend-structure.md), and a description needs a `textarea`, which
 * that component does not render.
 */
export function CreateWorkspaceForm(): ReactElement {
  const { mutate, isPending, error } = useCreateWorkspace();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fieldErrors = fieldErrorsByName(error);
  const nameError = fieldErrors['name'];
  const descriptionError = fieldErrors['description'];

  // Anything the server did not attribute to a field: an unreachable backend, or a failure this form
  // cannot point at a single input.
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    mutate(
      { name, description },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
        },
      },
    );
  };

  return (
    <section aria-labelledby="create-workspace-heading">
      <h2 id="create-workspace-heading">New workspace</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <p>
          <label htmlFor="workspace-name">Name</label>
          <input
            id="workspace-name"
            name="workspace-name"
            type="text"
            value={name}
            autoComplete="off"
            aria-invalid={nameError !== undefined}
            {...(nameError === undefined
              ? {}
              : { 'aria-describedby': 'workspace-name-error' })}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError === undefined ? null : (
            <span id="workspace-name-error">{nameError}</span>
          )}
        </p>

        <p>
          <label htmlFor="workspace-description">Description</label>
          <textarea
            id="workspace-description"
            name="workspace-description"
            value={description}
            aria-invalid={descriptionError !== undefined}
            {...(descriptionError === undefined
              ? {}
              : { 'aria-describedby': 'workspace-description-error' })}
            onChange={(event) => setDescription(event.target.value)}
          />
          {descriptionError === undefined ? null : (
            <span id="workspace-description-error">{descriptionError}</span>
          )}
        </p>

        <button type="submit" disabled={isPending}>
          {isPending ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </section>
  );
}
