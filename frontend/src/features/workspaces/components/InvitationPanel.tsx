import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
      <h2 id="invitation-heading">{uiText('ui.InvitationPanel.message001')}</h2>
      <p>{uiText('ui.InvitationPanel.message002')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <TextField
          id="invitation-email"
          label={uiText('ui.InvitationPanel.message003')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="invitation-role">{uiText('ui.InvitationPanel.message004')}</label>
        <select
          id="invitation-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Invitation['role'])}
        >
          <option value="VIEWER">{uiText('ui.AddMemberForm.message004')}</option>
          <option value="EDITOR">{uiText('ui.AddMemberForm.message003')}</option>
          <option value="OWNER">{uiText('ui.InvitationPanel.message005')}</option>
        </select>
        <Button type="submit" busy={create.isPending}>
          {uiText('ui.InvitationPanel.message006')}
        </Button>
      </form>
      {link ? (
        <div>
          <TextField
            id="invitation-link"
            label={uiText('ui.InvitationPanel.message007')}
            value={link}
            readOnly
          />
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => setCopyError(uiText('auth.copyError')),
              );
            }}
          >
            {uiText('ui.InvitationPanel.message008')}
          </Button>
          {copied ? <p role="status">{uiText('ui.InvitationPanel.message009')}</p> : null}
          {copyError ? <p role="alert">{copyError}</p> : null}
          <p>{uiText('ui.InvitationPanel.message010')}</p>
        </div>
      ) : null}
      {create.error || revoke.error ? (
        <p role="alert">{describeError(create.error ?? revoke.error)}</p>
      ) : null}
      {revoke.isSuccess ? (
        <p role="status">{uiText('ui.InvitationPanel.message011')}</p>
      ) : null}
      {invitations.isPending ? (
        <p role="status">{uiText('ui.InvitationPanel.message012')}</p>
      ) : invitations.error ? (
        <p role="alert">{describeError(invitations.error)}</p>
      ) : invitations.data?.length === 0 ? (
        <p>{uiText('ui.InvitationPanel.message013')}</p>
      ) : (
        <ul>
          {invitations.data?.map((invitation) => {
            const state = invitation.acceptedAt
              ? uiText('ui.InvitationPanel.message014')
              : invitation.revokedAt
                ? uiText('ui.InvitationPanel.message015')
                : invitation.expired
                  ? uiText('ui.InvitationPanel.message016')
                  : uiText('ui.InvitationPanel.message017');
            return (
              <li key={invitation.id}>
                {invitation.email} · {invitation.role} · {state}{' '}
                {uiText('ui.InvitationPanel.message018')}{' '}
                {new Date(invitation.expiresAt).toLocaleDateString(getIntlLocale())}
                {state === 'Pending' ? (
                  <Button
                    onClick={() => revoke.mutate(invitation.id)}
                    disabled={revoke.isPending}
                  >
                    {uiText('ui.InvitationPanel.message019')}
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
