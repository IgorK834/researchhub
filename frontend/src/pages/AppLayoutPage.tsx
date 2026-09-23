import type { ReactElement } from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Layout route for the authenticated app shell (`/app/*`).
 * Hosts future sidebar/header/workspace navigation; nested routes render via <Outlet />.
 */
export function AppLayoutPage(): ReactElement {
  return (
    <div>
      <header>
        <p>ResearchHub</p>
      </header>
      <Outlet />
    </div>
  );
}
