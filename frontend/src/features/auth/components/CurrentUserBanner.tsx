import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { useCurrentUser } from '../api/useAuth';

/**
 * Shows who is signed in, from `GET /api/auth/me`.
 *
 * This is the visible end of the session model: the page holds nothing across a reload, so whatever
 * appears here came from the server recognising the session cookie the browser still had.
 */
export function CurrentUserBanner(): ReactElement {
  const { data: user, error, isPending } = useCurrentUser();

  if (isPending) {
    return <p role="status">Checking your session…</p>;
  }

  // A 401 arrives as `user === null`, so a real error here means the request itself failed.
  if (error !== null) {
    return <p role="status">Could not check your session: {describeError(error)}</p>;
  }

  if (user === null || user === undefined) {
    return (
      <p role="status">
        You are not signed in. <Link to="/login">Log in</Link>
      </p>
    );
  }

  return (
    <p role="status">
      Signed in as {user.displayName} ({user.email})
    </p>
  );
}
