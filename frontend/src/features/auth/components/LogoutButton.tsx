import type { ReactElement } from 'react';
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
      <button type="button" onClick={submit} disabled={isPending}>
        {isPending ? 'Logging out…' : 'Log out'}
      </button>
      {error !== null ? (
        <span role="alert">Could not log out: {describeError(error)}</span>
      ) : null}
    </>
  );
}
