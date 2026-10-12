import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { describeError } from '../../../shared/api';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type Invitation,
} from '../api/invitationApi';

export function InvitationPanel({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactElement {
  const cache = useQueryClient();
  const key = ['workspaces', workspaceId, 'invitations'];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Invitation['role']>('VIEWER');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const invitations = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await listInvitations(workspaceId, signal)).map((invitation) => ({
        ...invitation,
        expired: new Date(invitation.expiresAt).getTime() <= Date.now(),
      })),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => createInvitation(workspaceId, email, role),
    onSuccess: (result) => {
      setLink(`${window.location.origin}${result.invitationPath}`);
      setCopied(false);
      setCopyError('');
      setEmail('');
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(workspaceId, id),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: key });
      setLink('');
    },
  });
  return (
    <section aria-labelledby="invitation-heading">
      <h2 id="invitation-heading">Invite by link</h2>
      <p>Invite someone with or without an account. Links expire after 7 days.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <TextField
          id="invitation-email"
          label="Invite email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="invitation-role">Invited role</label>
        <select
          id="invitation-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Invitation['role'])}
        >
          <option value="VIEWER">Viewer</option>
          <option value="EDITOR">Editor</option>
          <option value="OWNER">Owner</option>
        </select>
        <Button type="submit" busy={create.isPending}>
          Create invitation
        </Button>
      </form>
      {link ? (
        <div>
          <TextField id="invitation-link" label="Invitation link" value={link} readOnly />
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => setCopyError('Could not copy. Select and copy the link above.'),
              );
            }}
          >
            Copy invitation link
          </Button>
          {copied ? <p role="status">Link copied.</p> : null}
          {copyError ? <p role="alert">{copyError}</p> : null}
          <p>The link is shown once. Copy it before leaving this page.</p>
        </div>
      ) : null}
      {create.error || revoke.error ? (
        <p role="alert">{describeError(create.error ?? revoke.error)}</p>
      ) : null}
      {revoke.isSuccess ? <p role="status">Invitation revoked.</p> : null}
      {invitations.isPending ? (
        <p role="status">Loading invitations…</p>
      ) : invitations.error ? (
        <p role="alert">{describeError(invitations.error)}</p>
      ) : invitations.data?.length === 0 ? (
        <p>No invitations yet.</p>
      ) : (
        <ul>
          {invitations.data?.map((invitation) => {
            const state = invitation.acceptedAt
              ? 'Accepted'
              : invitation.revokedAt
                ? 'Revoked'
                : invitation.expired
                  ? 'Expired'
                  : 'Pending';
            return (
              <li key={invitation.id}>
                {invitation.email} · {invitation.role} · {state} · Expires{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}
                {state === 'Pending' ? (
                  <Button
                    onClick={() => revoke.mutate(invitation.id)}
                    disabled={revoke.isPending}
                  >
                    Revoke invitation
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
