import { useState, type ReactElement, type RefObject } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { TextField, Textarea } from '../../../shared/components/forms';
import { useCreateWorkspace } from '../api/useWorkspaces';
import { Button } from '../../../shared/components/Button';
import { Banner } from '../../../shared/components/feedback';
import { WorkspaceCard } from './WorkspaceCard';
import styles from './Workspaces.module.css';

/**
 * Form for creating a workspace.
 *
 * Validation messages come from the server's ProblemDetail `errors` array rather than being duplicated
 * here, so the field limits cannot drift from the backend's. The submitted name is cleared on success,
 * which is also when the list behind this form refetches.
 *
 * Shared TextField and Textarea own the accessible field chrome. This feature owns the draft,
 * submission and server errors, without importing components from another feature.
 */
export function CreateWorkspaceForm({
  onCancel,
  onCreated,
  initialFocusRef,
}: {
  readonly onCancel: () => void;
  readonly onCreated: () => void;
  readonly initialFocusRef: RefObject<HTMLInputElement | null>;
}): ReactElement {
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
    if (isPending) return;
    mutate(
      { name, description },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
          onCreated();
        },
      },
    );
  };

  return (
    <div className={styles.createLayout}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <Banner tone="error" lead={formMessage} /> : null}

        <TextField
          id="workspace-name"
          name="workspace-name"
          label="Name"
          type="text"
          size="large"
          ref={initialFocusRef}
          autoComplete="off"
          value={name}
          error={nameError}
          onChange={(event) => setName(event.target.value)}
        />

        <Textarea
          id="workspace-description"
          name="workspace-description"
          label="Description"
          hint="Optional"
          value={description}
          error={descriptionError}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className={styles.formActions}>
          <Button type="button" variant="secondary" size="large" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="large"
            busy={isPending}
            busyLabel="Creating…"
            aria-label={isPending ? 'Creating…' : undefined}
          >
            Create workspace
          </Button>
        </div>
      </form>
      <aside className={styles.preview} aria-label="Workspace preview">
        <p className={styles.previewLabel}>Preview</p>
        <WorkspaceCard preview name={name} description={description} />
        <p className={styles.previewHelp}>
          You&apos;ll add sources and invite people next.
        </p>
      </aside>
    </div>
  );
}
