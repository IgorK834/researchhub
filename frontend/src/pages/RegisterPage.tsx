import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useRegister } from '../features/auth/api/useAuth';
import { FormField } from '../features/auth/components/FormField';
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
  const [displayName, setDisplayName] = useState('');

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
    mutate(
      { email, password, displayName },
      {
        onSuccess: () => {
          setPassword('');
          void navigate('/login');
        },
      },
    );
  };

  return (
    <main>
      <h1>Register</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <FormField
          id="displayName"
          label="Display name"
          type="text"
          value={displayName}
          autoComplete="name"
          error={fieldErrors['displayName']}
          onChange={setDisplayName}
        />

        <FormField
          id="email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          error={emailError}
          onChange={setEmail}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          value={password}
          autoComplete="new-password"
          error={fieldErrors['password']}
          onChange={setPassword}
        />

        <button type="submit" disabled={isPending}>
          {isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p>
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
