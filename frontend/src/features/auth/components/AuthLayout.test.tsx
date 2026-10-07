/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthLayout } from './AuthLayout';

it('keeps the form before decorative art in both layouts and exposes the future art slot', () => {
  const { rerender } = render(
    <MemoryRouter>
      <AuthLayout variant="login" title="Log in" subtitle="Welcome" footer="Legal">
        <input aria-label="Email" />
      </AuthLayout>
    </MemoryRouter>,
  );
  expect(screen.getByRole('region', { name: 'Log in' })).toBeDefined();
  expect(screen.getByRole('link', { name: 'ResearchHub' }).getAttribute('href')).toBe(
    '/',
  );
  rerender(
    <MemoryRouter>
      <AuthLayout
        variant="register"
        title="Register"
        subtitle="Welcome"
        footer="Legal"
        art={<svg data-testid="art" />}
      >
        <input aria-label="Email" />
      </AuthLayout>
    </MemoryRouter>,
  );
  const main = screen.getByRole('main');
  const formHalf = screen.getByRole('region', { name: 'Register' });
  expect(main.firstElementChild).toBe(formHalf);
  expect(main.lastElementChild?.getAttribute('aria-hidden')).toBe('true');
  expect(main.lastElementChild?.contains(screen.getByTestId('art'))).toBe(true);
  expect(screen.getAllByRole('link')).toHaveLength(1);
});
