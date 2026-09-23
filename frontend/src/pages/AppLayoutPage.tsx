import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';

import { CurrentUserBanner } from '../features/auth/components/CurrentUserBanner';
import { LogoutButton } from '../features/auth/components/LogoutButton';
import { ApiStatusBanner } from '../shared/components/ApiStatusBanner';

/**
 * Shell for the authenticated app (`/app/*`). Hosts future sidebar, header, and workspace navigation;
 * nested routes render through <Outlet />.
 *
 * Mounted inside `RequireAuthenticatedUser`, so by the time this renders there is a signed-in user. It
 * does not repeat that check.
 */
export function AppLayoutPage(): ReactElement {
  return (
    <div>
      <header>
        <p>ResearchHub</p>
        <CurrentUserBanner />
        <LogoutButton />
        <ApiStatusBanner />
      </header>
      <Outlet />
    </div>
  );
}
