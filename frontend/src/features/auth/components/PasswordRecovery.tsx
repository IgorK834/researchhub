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
      title={complete ? 'Reset password' : 'Forgot password'}
      subtitle="Recover access to your account."
      footer="ResearchHub"
    >
      {action.isSuccess ? (
        <p role="status">
          {complete
            ? 'Password reset. All sessions have been signed out.'
            : 'If an account is eligible, a reset link will be sent.'}
        </p>
      ) : complete && !token ? (
        <p role="alert">A password reset link is required.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && password !== confirmation) {
              setFormError('Passwords do not match.');
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
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <TextField
                id="reset-confirm"
                label="Confirm new password"
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
              label="Email"
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
            {complete ? 'Reset password' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p>
        <Link to="/login">Back to login</Link>
      </p>
    </AuthLayout>
  );
}
