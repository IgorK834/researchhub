import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useLogin } from '../features/auth/api/useAuth';
import { FormField } from '../features/auth/components/FormField';
import { describeError, fieldErrorsByName, hasApiErrorCode } from '../shared/api';

/**
 * Sign-in form.
 *
 * On success the browser holds a session cookie and the user goes to `/app`. Nothing about the
 * credential is kept here: the password lives in component state only until the request is sent, and the
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
    <main>
      <h1>Log in</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
      >
        {formMessage !== null ? <p role="alert">{formMessage}</p> : null}

        <FormField
          id="email"
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          error={fieldErrors['email']}
          onChange={setEmail}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          error={fieldErrors['password']}
          onChange={setPassword}
        />

        <button type="submit" disabled={isPending}>
          {isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p>
        No account yet? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}
