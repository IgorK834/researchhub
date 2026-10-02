import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { TextField, ChoiceCards } from '../../../shared/components/forms';
import { Button } from '../../../shared/components/Button';
import { Panel } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import styles from './WorkspaceViews.module.css';
import { useAddWorkspaceMember } from '../api/useWorkspaces';

interface AddMemberFormProps {
  readonly workspaceId: string;
}

/**
 * Adds somebody who already has an account.
 *
 * The owner types a full address. There is no lookup-as-you-type and no suggestion list, because the
 * backend has no endpoint that could answer one: resolving partial addresses would let any account
 * enumerate the user table. The cost is that a typo is indistinguishable from an unregistered colleague,
 * and that is the intended trade.
 *
 * When the address has no active account the server answers 404 with one stable message, which is shown
 * as-is. Nothing here offers to invite the address instead — there is no invitation feature, and
 * pretending otherwise would promise an email that never arrives.
 *
 * Rendered only for an owner of an active workspace. The server enforces both conditions anyway.
 */
export function AddMemberForm({ workspaceId }: AddMemberFormProps): ReactElement {
  const { mutate, isPending, error } = useAddWorkspaceMember(workspaceId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');

  const fieldErrors = fieldErrorsByName(error);
  const emailError = fieldErrors['email'];
  const roleError = fieldErrors['role'];

  // The unknown-address 404 and the already-a-member 409 both arrive with a detail written for a person,
  // so they are shown as one message rather than pinned to a field.
  const formMessage =
    error !== null && Object.keys(fieldErrors).length === 0 ? describeError(error) : null;

  const submit = (): void => {
    if (isPending) return;
    mutate(
      { email, role },
      {
        onSuccess: () => {
          // The address of somebody now in the roster does not need to stay in component state.
          setEmail('');
        },
      },
    );
  };

  return (
    <div id="add-member-heading">
      <Panel title="Add a member">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          {formMessage !== null ? <Banner tone="error" lead={formMessage} /> : null}

          <TextField
            id="add-member-email"
            name="add-member-email"
            label="Email"
            type="email"
            autoComplete="off"
            value={email}
            disabled={isPending}
            error={emailError}
            onChange={(event) => setEmail(event.target.value)}
          />

          <ChoiceCards<'EDITOR' | 'VIEWER'>
            id="add-member-role"
            name="add-member-role"
            label="Role"
            value={role}
            error={roleError}
            onChange={setRole}
            disabled={isPending}
            options={[
              { value: 'EDITOR', label: 'Editor', icon: 'pencil' },
              { value: 'VIEWER', label: 'Viewer', icon: 'eye' },
            ]}
          />

          <Button
            type="submit"
            className={styles.addButton}
            busy={isPending}
            busyLabel="Adding…"
            aria-label={isPending ? 'Adding…' : undefined}
          >
            Add member
          </Button>
        </form>

        <p>Only people who already have a ResearchHub account can be added.</p>
      </Panel>
    </div>
  );
}
