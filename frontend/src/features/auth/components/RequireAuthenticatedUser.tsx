import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { describeError } from '../../../shared/api';
import { useCurrentUser } from '../api/useAuth';

/**
 * Layout route that renders its children only for a signed-in user.
 *
 * Deciding who the user is takes a round trip, because the only evidence is an HttpOnly cookie the page
 * cannot inspect. Three outcomes, and the distinction between the last two matters:
 *
 * - **Pending.** Render a status line and nothing else. Rendering the page underneath first would flash
 *   workspace content at an anonymous visitor for as long as the request takes, and then yank it away.
 *   `<Outlet />` is not mounted, so no child route fires its own requests either.
 * - **No session.** Redirect to `/login`, replacing the history entry so Back does not return to a page
 *   that will only bounce again.
 * - **Request failed.** Show the error and stay put. A backend that is down is not the same as a user who
 *   is signed out, and redirecting to a login form that also cannot reach the server would just hide the
 *   real problem.
 */
export function RequireAuthenticatedUser(): ReactElement {
  const { data: user, error, isPending } = useCurrentUser();

  if (isPending) {
    return (
      <main>
        <p role="status">Checking your session…</p>
      </main>
    );
  }

  // `useCurrentUser` turns a 401 into `null`, so a non-null error here is a genuine failure.
  if (error !== null) {
    return (
      <main>
        <p role="alert">Could not check your session: {describeError(error)}</p>
      </main>
    );
  }

  if (user === null || user === undefined) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
