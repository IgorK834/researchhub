import { useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRegister } from '../features/auth/api/useAuth';
import { AuthLayout } from '../features/auth/components/AuthLayout';
import styles from '../features/auth/components/AuthLayout.module.css';
import { Button } from '../shared/components/Button';
import { TextField } from '../shared/components/forms';
import { describeError, fieldErrorsByName, hasApiErrorCode } from '../shared/api';

/**
 * Account creation form.
 *
 * Registration does not sign the user in — the backend answers 201 without a session — so a successful
 * submission sends them to the login form rather than into the app.
 */
export function RegisterPage(): ReactElement {
  const navigate = useNavigate();
  const { mutate, isPending, error } = useRegister();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');

  // Compare the exact values: whitespace is part of a password. Confirmation is never sent to API.
  const confirmError =
    password !== confirmPassword && (confirmPassword.length > 0 || confirmTouched)
      ? 'Passwords do not match.'
      : undefined;

  const fieldErrors = fieldErrorsByName(error);

  // A duplicate address is a 409 with a detail written for the user, and it belongs next to the email
  // field rather than in a general banner, because that is the input they need to change.
  const duplicateEmail = hasApiErrorCode(error, 'CONFLICT')
    ? describeError(error)
    : undefined;
  const emailError = fieldErrors['email'] ?? duplicateEmail;

  const formMessage =
    error !== null &&
    Object.keys(fieldErrors).length === 0 &&
    duplicateEmail === undefined
      ? describeError(error)
      : null;

  const submit = (): void => {
    if (isPending) return;
    if (password !== confirmPassword) {
      setConfirmTouched(true);
      confirmRef.current?.focus();
      return;
    }
    mutate(
      { email, password, displayName },
      {
        onSuccess: () => {
          setPassword('');
          setConfirmPassword('');
          void navigate('/login');
        },
      },
    );
  };

  return (
    <AuthLayout
      variant="register"
      title="Register"
      subtitle="Takes a minute. You can invite your team afterwards."
      footer="By creating an account you accept the Terms and Privacy policy."
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
          id="displayName"
          name="displayName"
          label="Display name"
          type="text"
          value={displayName}
          autoComplete="name"
          error={fieldErrors['displayName']}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <TextField
          size="large"
          id="email"
          name="email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          error={emailError}
          onChange={(event) => setEmail(event.target.value)}
        />

        <div className={styles.passwordRow}>
          <TextField
            size="large"
            id="password"
            name="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="new-password"
            error={fieldErrors['password']}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            size="large"
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm password"
            type="password"
            value={confirmPassword}
            autoComplete="new-password"
            error={confirmError}
            ref={confirmRef}
            onBlur={() => setConfirmTouched(true)}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="large"
          busy={isPending}
          busyLabel="Creating account…"
          aria-label={isPending ? 'Creating account…' : undefined}
          className={styles.submit}
        >
          Create account
        </Button>
      </form>

      <p className={styles.accountLink}>
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
