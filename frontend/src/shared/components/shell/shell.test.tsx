/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { AppShell, ShellSidebar, ResearchHubMark } from './index';

const user = { id: 'adam', displayName: 'Adam Nowak', email: 'adam@uni.edu' };
it('provides one main, a skip target, sidebar, member stack and context action slot', () => {
  const { rerender } = render(
    <AppShell
      sidebar={<nav aria-label="Application">Home</nav>}
      breadcrumb={<nav aria-label="Breadcrumb">Home</nav>}
      members={[
        { userId: 'a', name: 'Adam' },
        { userId: 'b', name: 'Kasia' },
      ]}
      primaryAction={<button>New workspace</button>}
    >
      <h1>Workspaces</h1>
    </AppShell>,
  );
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
    `#${screen.getByRole('main').id}`,
  );
  expect(screen.getByRole('complementary', { name: 'Application sidebar' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Workspace members' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'New workspace' })).toBeTruthy();
  rerender(
    <AppShell
      sidebar="Sidebar"
      breadcrumb="Home"
      members={[{ userId: 'a', name: 'Adam' }]}
    >
      Page
    </AppShell>,
  );
  expect(screen.queryByRole('group', { name: 'Workspace members' })).toBeNull();
  rerender(
    <AppShell sidebar="Sidebar" breadcrumb="Home">
      Page
    </AppShell>,
  );
});
it('composes the sidebar and preserves full identity text behind visual truncation', () => {
  const { rerender } = render(
    <ShellSidebar
      brand={<ResearchHubMark />}
      switcher="Switcher"
      navigation="Navigation"
      sticker="Grounded in 2 sources"
      footer="Settings"
      user={user}
      signOut={<button>Log out</button>}
    />,
  );
  expect(screen.getByTitle(user.displayName).textContent).toBe(user.displayName);
  expect(screen.getByTitle(user.email).textContent).toBe(user.email);
  expect(document.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelectorAll('svg rect')).toHaveLength(5);
  rerender(
    <ShellSidebar
      brand="Brand"
      switcher="Switcher"
      navigation="Navigation"
      user={user}
      signOut="Log out"
    />,
  );
  expect(document.querySelector('.sticker')).toBeNull();
});
