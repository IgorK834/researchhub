import type { ReactElement } from 'react';

import { useCurrentUser } from '../api/useAuth';

/**
 * Shows who is signed in.
 *
 * This is the visible end of the session model: the page keeps nothing across a reload, so the name here
 * came from the server recognising the session cookie the browser still had.
 *
 * Rendered inside `RequireAuthenticatedUser`, which has already resolved the loading, error, and
 * signed-out cases, and reads the same cached query rather than issuing a second request. The empty
 * fallback exists only so this component is honest on its own terms if it is ever placed outside the
 * guard.
 */
export function CurrentUserBanner(): ReactElement | null {
  const { data: user } = useCurrentUser();

  if (user === null || user === undefined) {
    return null;
  }

  return (
    <p role="status">
      Signed in as {user.displayName} ({user.email})
    </p>
  );
}
