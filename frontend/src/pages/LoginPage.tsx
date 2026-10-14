import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

import { useLogin } from '../features/auth/api/useAuth';
import { AuthLayout } from '../features/auth/components/AuthLayout';
import styles from '../features/auth/components/AuthLayout.module.css';
import { TextField } from '../shared/components/forms';
import { Badge } from '../shared/components/identity';
import { describeError, fieldErrorsByName, hasApiErrorCode } from '../shared/api';
import { Button } from '../shared/components/Button';
import { usePublicConfig } from '../app/PublicConfig';

/**
 * Sign-in form.
 *
 * On success the browser holds a session cookie and the user goes to `/app`. Nothing about the
 * credential is persisted here: the password is cleared after a successful request, and the
 * session id is in a cookie the page cannot read.
 */
export function LoginPage(): ReactElement {
  useUiLocale();
  const { config } = usePublicConfig();
  const navigate = useNavigate();
  const returnAction = useLocation().hash.slice(1);
  const { mutate, isPending, error } = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const fieldErrors = fieldErrorsByName(error);

  // Rejected credentials get one deliberately vague message. The backend refuses to say whether the
  // address exists, and repeating a guess here would undo that.
  const credentialsRejected = hasApiErrorCode(error, 'UNAUTHENTICATED');
  const formMessage = credentialsRejected
    ? uiText('ui.LoginPage.message001')
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
          const match = /^(invite|verify):([A-Za-z0-9_-]{43})$/.exec(returnAction);
          void navigate(
            match
              ? `${match[1] === 'invite' ? '/invitations' : '/verify-email'}#${match[2]}`
              : '/app',
          );
        },
      },
    );
  };

  return (
    <AuthLayout
      variant="login"
      title={uiText('ui.AccountLink.message007')}
      subtitle={uiText('ui.LoginPage.message002')}
      footer={uiText('ui.Sections.message020')}
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
          label={uiText('ui.PasswordRecovery.message007')}
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
          label={uiText('ui.LoginPage.message003')}
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
          busyLabel={uiText('ui.LoginPage.message004')}
          aria-label={isPending ? uiText('ui.LoginPage.message004') : undefined}
          className={styles.submit}
        >
          {uiText('ui.AccountLink.message007')}
        </Button>
      </form>
      <p>
        <Link to="/forgot-password">{uiText('ui.LoginPage.message005')}</Link>
      </p>
      <div className={styles.divider}>{uiText('ui.LoginPage.message006')}</div>
      <Button
        type="button"
        variant="secondary"
        size="large"
        disabled
        aria-label={uiText('ui.LoginPage.message007')}
        aria-describedby="google-soon"
        className={styles.google}
      >
        <span className={styles.googleContent}>
          {uiText('ui.LoginPage.message007')}
          <span id="google-soon">
            <Badge
              label={uiText('ui.LoginPage.message008')}
              icon="clock"
              tone="yellow"
              size="compact"
            />
          </span>
        </span>
      </Button>
      {config?.registrationMode === 'open' ? (
        <p className={styles.accountLink}>
          {uiText('ui.LoginPage.message009')}{' '}
          <Link to="/register">{uiText('ui.LandingHeader.message001')}</Link>
        </p>
      ) : null}
    </AuthLayout>
  );
}
