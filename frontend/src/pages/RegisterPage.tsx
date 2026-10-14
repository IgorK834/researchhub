import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import { useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

import { useRegister } from '../features/auth/api/useAuth';
import { AuthLayout } from '../features/auth/components/AuthLayout';
import styles from '../features/auth/components/AuthLayout.module.css';
import { Button } from '../shared/components/Button';
import { TextField } from '../shared/components/forms';
import { describeError, fieldErrorsByName, hasApiErrorCode } from '../shared/api';
import { usePublicConfig } from '../app/PublicConfig';
import { RegistrationNotice } from '../features/auth/components/RegistrationNotice';

/**
 * Account creation form.
 *
 * Registration does not sign the user in — the backend answers 201 without a session — so a successful
 * submission sends them to the login form rather than into the app.
 */
export function RegisterPage(): ReactElement {
  useUiLocale();
  const { config } = usePublicConfig();
  const navigate = useNavigate();
  const invitationToken = useLocation().hash.slice(1);
  const registrationAllowed =
    config?.registrationMode === 'open' ||
    (config?.registrationMode === 'invite-only' && invitationToken.length > 0);
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
      ? uiText('ui.RegisterPage.message001')
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
    if (isPending || !registrationAllowed) return;
    if (password !== confirmPassword) {
      setConfirmTouched(true);
      confirmRef.current?.focus();
      return;
    }
    mutate(
      { email, password, displayName, ...(invitationToken ? { invitationToken } : {}) },
      {
        onSuccess: () => {
          setPassword('');
          setConfirmPassword('');
          void navigate(invitationToken ? `/login#invite:${invitationToken}` : '/login');
        },
      },
    );
  };

  if (!registrationAllowed) return <RegistrationNotice />;

  return (
    <AuthLayout
      variant="register"
      title={uiText('ui.RegisterPage.message002')}
      subtitle={uiText('ui.RegisterPage.message003')}
      footer={uiText('ui.RegisterPage.message004')}
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
          label={uiText('ui.SourceMetadataPanel.message019')}
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
          label={uiText('ui.PasswordRecovery.message007')}
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
            label={uiText('ui.LoginPage.message003')}
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
            label={uiText('ui.RegisterPage.message005')}
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
          busyLabel={uiText('ui.RegisterPage.message006')}
          aria-label={isPending ? uiText('ui.RegisterPage.message006') : undefined}
          className={styles.submit}
        >
          {uiText('ui.LandingHeader.message001')}
        </Button>
      </form>

      <p className={styles.accountLink}>
        {uiText('ui.RegisterPage.message007')}{' '}
        <Link to="/login">{uiText('ui.AccountLink.message007')}</Link>
      </p>
    </AuthLayout>
  );
}
