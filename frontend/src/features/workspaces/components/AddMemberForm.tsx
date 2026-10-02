import { useState, type ReactElement } from 'react';

import { describeError, fieldErrorsByName } from '../../../shared/api';
import { TextField, Select } from '../../../shared/components/forms';
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
    <section aria-labelledby="add-member-heading">
      <h2 id="add-member-heading">Add a member</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <TextField
          id="add-member-email"
          name="add-member-email"
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          error={emailError}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Select
          id="add-member-role"
          name="add-member-role"
          label="Role"
          value={role}
          error={roleError}
          onChange={(event) =>
            setRole(event.target.value === 'VIEWER' ? 'VIEWER' : 'EDITOR')
          }
        >
          <option value="EDITOR">EDITOR</option>
          <option value="VIEWER">VIEWER</option>
        </Select>

        <button type="submit" disabled={isPending}>
          {isPending ? 'Adding…' : 'Add member'}
        </button>
      </form>

      <p>Only people who already have a ResearchHub account can be added.</p>
    </section>
  );
}
