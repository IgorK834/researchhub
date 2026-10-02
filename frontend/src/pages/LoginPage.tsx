import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useLogin } from '../features/auth/api/useAuth';
import { AuthLayout } from '../features/auth/components/AuthLayout';
import styles from '../features/auth/components/AuthLayout.module.css';
import { TextField } from '../shared/components/forms';
import { Badge } from '../shared/components/identity';
import { describeError, fieldErrorsByName, hasApiErrorCode } from '../shared/api';
import { Button } from '../shared/components/Button';

/**
 * Sign-in form.
 *
 * On success the browser holds a session cookie and the user goes to `/app`. Nothing about the
 * credential is persisted here: the password is cleared after a successful request, and the
 * session id is in a cookie the page cannot read.
 */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const { mutate, isPending, error } = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const fieldErrors = fieldErrorsByName(error);

  // Rejected credentials get one deliberately vague message. The backend refuses to say whether the
  // address exists, and repeating a guess here would undo that.
  const credentialsRejected = hasApiErrorCode(error, 'UNAUTHENTICATED');
  const formMessage = credentialsRejected
    ? 'Invalid email or password.'
    : error !== null && Object.keys(fieldErrors).length === 0
      ? describeError(error)
      : null;

  const submit = (): void => {
    if (isPending) return;
    mutate(
      { email, password },
      {
        onSuccess: () => {
          setPassword('');
          void navigate('/app');
        },
      },
    );
  };

  return (
    <AuthLayout
      variant="login"
      title="Log in"
      subtitle="Pick up your workspace where you left it."
      footer="© ResearchHub · Privacy · Terms"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? (
          <p role="alert" className={styles.formError}>
            {formMessage}
          </p>
        ) : null}

        <TextField
          size="large"
          id="email"
          name="email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          error={fieldErrors['email']}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextField
          size="large"
          id="password"
          name="password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          error={fieldErrors['password']}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button
          type="submit"
          size="large"
          busy={isPending}
          busyLabel="Logging in…"
          aria-label={isPending ? 'Logging in…' : undefined}
          className={styles.submit}
        >
          Log in
        </Button>
      </form>
      <div className={styles.divider}>or</div>
      <Button
        type="button"
        variant="secondary"
        size="large"
        disabled
        aria-label="Continue with Google"
        aria-describedby="google-soon"
        className={styles.google}
      >
        <span className={styles.googleContent}>
          Continue with Google
          <span id="google-soon">
            <Badge label="Soon" icon="clock" tone="yellow" size="compact" />
          </span>
        </span>
      </Button>
      <p className={styles.accountLink}>
        No account yet? <Link to="/register">Create account</Link>
      </p>
    </AuthLayout>
  );
}
