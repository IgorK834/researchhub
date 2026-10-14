import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { describeError } from '../../../shared/api';
import { requestReset, resetPassword } from '../api/accountApi';

export function PasswordRecovery({
  complete = false,
}: {
  readonly complete?: boolean;
}): ReactElement {
  useUiLocale();
  const { hash } = useLocation();
  const token = hash.slice(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [formError, setFormError] = useState('');
  const action = useMutation({
    mutationFn: () => (complete ? resetPassword(token, password) : requestReset(email)),
    onSuccess: () => {
      setPassword('');
      setConfirmation('');
    },
  });
  return (
    <AuthLayout
      variant="login"
      title={
        complete
          ? uiText('ui.PasswordRecovery.message001')
          : uiText('ui.PasswordRecovery.message002')
      }
      subtitle={uiText('ui.PasswordRecovery.message003')}
      footer="ResearchHub"
    >
      {action.isSuccess ? (
        <p role="status">
          {complete
            ? uiText('ui.PasswordRecovery.message004')
            : uiText('ui.PasswordRecovery.message005')}
        </p>
      ) : complete && !token ? (
        <p role="alert">{uiText('ui.PasswordRecovery.message006')}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && password !== confirmation) {
              setFormError(uiText('ui.RegisterPage.message001'));
              return;
            }
            setFormError('');
            action.mutate();
          }}
        >
          {complete ? (
            <>
              <TextField
                id="reset-password"
                label={uiText('ui.AccountSettings.message007')}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <TextField
                id="reset-confirm"
                label={uiText('ui.AccountSettings.message008')}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </>
          ) : (
            <TextField
              id="reset-email"
              label={uiText('ui.PasswordRecovery.message007')}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          )}
          {formError ? <p role="alert">{formError}</p> : null}
          {action.error ? <p role="alert">{describeError(action.error)}</p> : null}
          <Button type="submit" busy={action.isPending}>
            {complete
              ? uiText('ui.PasswordRecovery.message001')
              : uiText('ui.PasswordRecovery.message008')}
          </Button>
        </form>
      )}
      <p>
        <Link to="/login">{uiText('ui.PasswordRecovery.message009')}</Link>
      </p>
    </AuthLayout>
  );
}
