import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import * as api from '../api/accountApi';
import styles from './AccountSettings.module.css';
import { AccountDataSettings } from './AccountDataSettings';

export function AccountSettings(): ReactElement {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: ({ signal }) => api.listSessions(signal),
    retry: false,
  });
  const verification = useQuery({
    queryKey: ['auth', 'verification'],
    queryFn: ({ signal }) => api.verificationStatus(signal),
    retry: false,
  });
  const signedOut = (): void => {
    cache.clear();
    void navigate('/login');
  };
  const password = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setMessage('Password changed. Other sessions have been signed out.');
      void cache.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (session: api.SessionSummary) => api.revokeSession(session.handle),
    onSuccess: (_, session) => {
      if (session.current) signedOut();
      else {
        setMessage('Session revoked.');
        void cache.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      }
    },
  });
  const revokeAll = useMutation({
    mutationFn: api.revokeAllSessions,
    onSuccess: signedOut,
  });
  const verify = useMutation({
    mutationFn: api.requestVerification,
    onSuccess: () => setMessage('Verification link requested. Check your email.'),
  });
  const error = password.error ?? revoke.error ?? revokeAll.error ?? verify.error;
  return (
    <section className={styles.page}>
      <h1>Account settings</h1>
      <AccountDataSettings />
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{describeError(error)}</p> : null}
      <section>
        <h2>Email verification</h2>
        {verification.isPending ? (
          <p role="status">Loading email status…</p>
        ) : verification.error ? (
          <p role="alert">{describeError(verification.error)}</p>
        ) : verification.data?.emailVerifiedAt ? (
          <p>Email verified.</p>
        ) : (
          <>
            <p>Verify your email before accepting workspace invitations.</p>
            <Button onClick={() => verify.mutate()} busy={verify.isPending}>
              Send verification link
            </Button>
          </>
        )}
      </section>
      <section>
        <h2>Change password</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== confirmation) {
              setFormError('Passwords do not match.');
              return;
            }
            setFormError('');
            setMessage('');
            password.mutate();
          }}
        >
          <TextField
            id="account-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <TextField
            id="account-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <TextField
            id="account-confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          {formError ? <p role="alert">{formError}</p> : null}
          <Button type="submit" busy={password.isPending}>
            Change password
          </Button>
        </form>
      </section>
      <section>
        <h2>Active sessions</h2>
        {sessions.isPending ? (
          <p role="status">Loading sessions…</p>
        ) : sessions.error ? (
          <>
            <p role="alert">{describeError(sessions.error)}</p>
            <Button
              onClick={() => {
                void sessions.refetch();
              }}
            >
              Try again
            </Button>
          </>
        ) : sessions.data?.length === 0 ? (
          <p>No active sessions.</p>
        ) : (
          <ul>
            {sessions.data?.map((session) => (
              <li key={session.handle}>
                <strong>{session.userAgent}</strong>
                {session.current ? ' — Current session' : ''}
                <p>
                  Created {new Date(session.createdAt).toLocaleString()} · Last active{' '}
                  {new Date(session.lastAccessedAt).toLocaleString()}
                </p>
                <Button
                  onClick={() => revoke.mutate(session)}
                  disabled={revoke.isPending || revokeAll.isPending}
                >
                  Revoke session
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          onClick={() => revokeAll.mutate()}
          busy={revokeAll.isPending}
          disabled={revoke.isPending}
        >
          Sign out all sessions
        </Button>
      </section>
    </section>
  );
}
