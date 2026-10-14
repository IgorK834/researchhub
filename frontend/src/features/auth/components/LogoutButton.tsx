import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { useNavigate } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { useLogout } from '../api/useAuth';

/**
 * Ends the session and leaves the authenticated area.
 *
 * The POST goes through the shared client, which attaches the CSRF header, so logout is protected like
 * any other mutating request — a third-party page cannot sign the user out by embedding a form.
 */
export function LogoutButton(): ReactElement {
  useUiLocale();
  const navigate = useNavigate();
  const { mutate, isPending, error } = useLogout();

  const submit = (): void => {
    mutate(undefined, {
      // Navigate only after the server has invalidated the session and the cache has been cleared, so
      // the login page cannot briefly read a stale user out of the cache.
      onSuccess: () => {
        void navigate('/login', { replace: true });
      },
    });
  };

  return (
    <>
      <Button
        aria-label={
          isPending
            ? uiText('ui.LogoutButton.message001')
            : uiText('ui.LogoutButton.message002')
        }
        variant="ghost"
        size="compact"
        icon="logout"
        onClick={submit}
        disabled={isPending}
      >
        <span data-rh-label="">
          {isPending
            ? uiText('ui.LogoutButton.message001')
            : uiText('ui.LogoutButton.message002')}
        </span>
      </Button>
      {error !== null ? (
        <span role="alert">
          {uiText('ui.LogoutButton.message003')} {describeError(error)}
        </span>
      ) : null}
    </>
  );
}
