import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { usePublicConfig } from '../../../app/PublicConfig';
import { AuthLayout } from './AuthLayout';

export function RegistrationNotice(): ReactElement {
  useUiLocale();
  const { config, failed } = usePublicConfig();
  const message =
    config?.registrationMode === 'disabled'
      ? uiText('ui.RegistrationNotice.message001')
      : config?.registrationMode === 'invite-only'
        ? uiText('ui.RegistrationNotice.message002')
        : failed
          ? uiText('ui.RegistrationNotice.message003')
          : uiText('ui.RegistrationNotice.message004');
  return (
    <AuthLayout
      variant="register"
      title={uiText('ui.RegistrationNotice.message005')}
      subtitle={message}
      footer={uiText('ui.RegistrationNotice.message006')}
    >
      <p role="status">{message}</p>
      <Link to="/login">{uiText('ui.AccountLink.message007')}</Link>
    </AuthLayout>
  );
}
