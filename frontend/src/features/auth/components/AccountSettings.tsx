import { DigestPreferences } from '../../notifications/DigestPanel';
import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
      setMessage(uiText('ui.AccountSettings.message017'));
      void cache.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (session: api.SessionSummary) => api.revokeSession(session.handle),
    onSuccess: (_, session) => {
      if (session.current) signedOut();
      else {
        setMessage(uiText('ui.AccountSettings.message018'));
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
    onSuccess: () => setMessage(uiText('ui.AccountLink.message013')),
  });
  const error = password.error ?? revoke.error ?? revokeAll.error ?? verify.error;
  return (
    <section className={styles.page}>
      <h1>{uiText('ui.AccountLink.message017')}</h1>
      <AccountDataSettings />
      <DigestPreferences />
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{describeError(error)}</p> : null}
      <section>
        <h2>{uiText('ui.AccountSettings.message001')}</h2>
        {verification.isPending ? (
          <p role="status">{uiText('ui.AccountSettings.message002')}</p>
        ) : verification.error ? (
          <p role="alert">{describeError(verification.error)}</p>
        ) : verification.data?.emailVerifiedAt ? (
          <p>{uiText('ui.AccountSettings.message003')}</p>
        ) : (
          <>
            <p>{uiText('ui.AccountSettings.message004')}</p>
            <Button onClick={() => verify.mutate()} busy={verify.isPending}>
              {uiText('ui.AccountLink.message011')}
            </Button>
          </>
        )}
      </section>
      <section>
        <h2>{uiText('ui.AccountSettings.message005')}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newPassword !== confirmation) {
              setFormError(uiText('ui.RegisterPage.message001'));
              return;
            }
            setFormError('');
            setMessage('');
            password.mutate();
          }}
        >
          <TextField
            id="account-current-password"
            label={uiText('ui.AccountSettings.message006')}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <TextField
            id="account-new-password"
            label={uiText('ui.AccountSettings.message007')}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <TextField
            id="account-confirm-password"
            label={uiText('ui.AccountSettings.message008')}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          {formError ? <p role="alert">{formError}</p> : null}
          <Button type="submit" busy={password.isPending}>
            {uiText('ui.AccountSettings.message005')}
          </Button>
        </form>
      </section>
      <section>
        <h2>{uiText('ui.AccountSettings.message009')}</h2>
        {sessions.isPending ? (
          <p role="status">{uiText('ui.AccountSettings.message010')}</p>
        ) : sessions.error ? (
          <>
            <p role="alert">{describeError(sessions.error)}</p>
            <Button
              onClick={() => {
                void sessions.refetch();
              }}
            >
              {uiText('ui.AnalysisChart.message004')}
            </Button>
          </>
        ) : sessions.data?.length === 0 ? (
          <p>{uiText('ui.AccountSettings.message011')}</p>
        ) : (
          <ul>
            {sessions.data?.map((session) => (
              <li key={session.handle}>
                <strong>{session.userAgent}</strong>
                {session.current ? ' ' + uiText('ui.AccountSettings.message012') : ''}
                <p>
                  {uiText('ui.AccountSettings.message013')}{' '}
                  {new Date(session.createdAt).toLocaleString(getIntlLocale())}{' '}
                  {uiText('ui.AccountSettings.message014')}{' '}
                  {new Date(session.lastAccessedAt).toLocaleString(getIntlLocale())}
                </p>
                <Button
                  onClick={() => revoke.mutate(session)}
                  disabled={revoke.isPending || revokeAll.isPending}
                >
                  {uiText('ui.AccountSettings.message015')}
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
          {uiText('ui.AccountSettings.message016')}
        </Button>
      </section>
    </section>
  );
}
