/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';

import { RoleBadge } from './RoleBadge';

it.each([
  ['OWNER', 'Owner', 'ink'],
  ['EDITOR', 'Editor', 'lavender'],
  ['VIEWER', 'Viewer', 'neutral'],
  ['REVIEWER', 'REVIEWER', 'neutral'],
  ['', 'Unknown role', 'neutral'],
])('renders %s as a labelled role badge with a decorative icon', (role, label, tone) => {
  render(<RoleBadge role={role} />);
  const badge = screen.getByText(label!);
  expect(badge.classList.contains(tone!)).toBe(true);
  expect(badge.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});
