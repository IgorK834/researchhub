import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { usePublicConfig } from '../../../app/PublicConfig';
import { AuthLayout } from './AuthLayout';

export function RegistrationNotice(): ReactElement {
  const { config, failed } = usePublicConfig();
  const message =
    config?.registrationMode === 'disabled'
      ? 'Account registration is disabled in this environment.'
      : config?.registrationMode === 'invite-only'
        ? 'Registration is by invitation only. Contact the operator for access.'
        : failed
          ? 'Registration settings could not be loaded. Please try again later.'
          : 'Loading registration settings…';
  return (
    <AuthLayout
      variant="register"
      title="Registration unavailable"
      subtitle={message}
      footer="© ResearchHub"
    >
      <p role="status">{message}</p>
      <Link to="/login">Log in</Link>
    </AuthLayout>
  );
}
