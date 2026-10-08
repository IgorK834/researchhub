/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { useCurrentUser } from '../features/auth/api/useAuth';
import { LandingPage } from './LandingPage';

jest.mock('../features/auth/api/useAuth');

function Location(): ReactElement {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderLanding(user: unknown = null): void {
  jest
    .mocked(useCurrentUser)
    .mockReturnValue({ data: user } as ReturnType<typeof useCurrentUser>);
  render(
    <MemoryRouter initialEntries={['/']}>
      <Location />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<h1>Elsewhere</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const path = (): string => screen.getByLabelText('Current path').textContent ?? '';

afterEach(cleanup);

it('presents the product, the capabilities and both plans', () => {
  renderLanding();
  expect(
    screen.getByRole('heading', { level: 1, name: /Research together/ }),
  ).toBeTruthy();
  for (const name of [
    'Chat with a PDF is not research',
    'See how it works.',
    'Everything a research group needs, in one workspace.',
    'Simple plans that grow with your research.',
  ])
    expect(screen.getByRole('heading', { name: new RegExp(name) })).toBeTruthy();
  const pricing = screen.getByRole('region', { name: /Simple plans/ });
  expect(within(pricing).getByRole('article', { name: 'Free' })).toBeTruthy();
  expect(within(pricing).getByRole('article', { name: 'Premium' })).toBeTruthy();
  expect(within(pricing).getByText('$0')).toBeTruthy();
});

it('keeps in-page navigation anchored to real sections', () => {
  renderLanding();
  const nav = screen.getByRole('navigation', { name: 'Sections' });
  for (const id of ['product', 'features', 'how-it-works', 'pricing', 'faq']) {
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toContain(`#${id}`);
    expect(document.getElementById(id)).not.toBeNull();
  }
});

it('sends Log in and Create account to the auth routes without reloading', () => {
  renderLanding();
  const header = screen.getAllByRole('banner')[0]!;
  const login = within(header).getAllByRole('link', { name: 'Log in' })[0]!;
  expect(login.getAttribute('href')).toBe('/login');
  fireEvent.click(login);
  expect(path()).toBe('/login');
});

it('lets every plan lead to registration', () => {
  renderLanding();
  const pricing = screen.getByRole('region', { name: /Simple plans/ });
  const premium = within(pricing).getByRole('link', {
    name: 'Start free, upgrade later',
  });
  expect(premium.getAttribute('href')).toBe('/register');
  fireEvent.click(premium);
  expect(path()).toBe('/register');
});

it('switches the product walkthrough and toggles FAQ answers', () => {
  renderLanding();
  const tab = screen.getByRole('tab', { name: 'Sources' });
  fireEvent.click(tab);
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(
    screen.getByRole('img', { name: /source library listing six lab files/ }),
  ).toBeTruthy();

  const question = screen.getByRole('button', { name: /Which files can I upload/ });
  expect(question.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(question);
  expect(question.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText(/up to 50 MB each/, { selector: 'p' })).toBeTruthy();
});

it('opens and closes the mobile menu', () => {
  renderLanding();
  const toggle = screen.getByRole('button', { name: 'Open menu' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  const close = screen.getByRole('button', { name: 'Close menu' });
  expect(close.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(close);
  expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
});

it('offers the app instead of the auth links to a signed-in visitor', () => {
  renderLanding({ id: 'u', displayName: 'Ada', email: 'a@b.c' });
  const header = screen.getAllByRole('banner')[0]!;
  expect(within(header).queryByRole('link', { name: 'Create account' })).toBeNull();
  fireEvent.click(within(header).getAllByRole('link', { name: 'Open workspaces' })[0]!);
  expect(path()).toBe('/app');
});

jest.mock('../app/PublicConfig', () => ({
  usePublicConfig: () => ({
    config: { registrationMode: 'open' },
    pending: false,
    failed: false,
  }),
}));
