/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';

import {
  Avatar,
  AvatarStack,
  Badge,
  Chip,
  Sticker,
  avatarTone,
  initials,
  type BadgeTone,
  type AvatarSize,
} from './index';

it.each<BadgeTone>(['neutral', 'blue', 'coral', 'lavender', 'mint', 'yellow', 'ink'])(
  'renders %s badges with a visible word and decorative icon in both styles and sizes',
  (tone) => {
    const { rerender } = render(<Badge label="Ready" icon="check" tone={tone} />);
    expect(screen.getByText('Ready').classList.contains(tone)).toBe(true);
    expect(
      screen.getByText('Ready').querySelector('svg')?.getAttribute('aria-hidden'),
    ).toBe('true');
    rerender(
      <Badge
        label="Ready"
        icon="check"
        tone={tone}
        variant="outlined"
        size="compact"
        className="custom"
      />,
    );
    expect(screen.getByText('Ready').classList.contains('outlined')).toBe(true);
    expect(screen.getByText('Ready').classList.contains('compact')).toBe(true);
    expect(screen.getByText('Ready').classList.contains('custom')).toBe(true);
  },
);
it('rejects color-only badges and stickers', () => {
  expect(() => render(<Badge label=" " icon="check" />)).toThrow('visible label');
  expect(() => render(<Sticker label=" " />)).toThrow('visible label');
});
it('supports named chip removal and a static chip', () => {
  const remove = jest.fn();
  const { rerender } = render(<Chip label="Smith 2025" icon="book" onRemove={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Smith 2025' }));
  expect(remove).toHaveBeenCalledTimes(1);
  rerender(<Chip label="Grounded" icon="shield" />);
  expect(screen.queryByRole('button')).toBeNull();
});
it.each<AvatarSize>(['xs', 'sm', 'md', 'lg'])(
  'renders an accessible %s avatar',
  (size) => {
    render(<Avatar name="Adam Nowak" userId="adam" size={size} />);
    const avatar = screen.getByRole('img', { name: 'Adam Nowak' });
    expect(avatar.textContent).toBe('AN');
    expect(avatar.classList.contains(size)).toBe(true);
    expect(avatar.classList.contains(avatarTone('adam'))).toBe(true);
  },
);
it('derives unicode initials and stable colors from ids, including fallback names', () => {
  expect(initials('  Kasia   Wiśniewska ')).toBe('KW');
  expect(initials('Żaneta')).toBe('Ż');
  expect(initials('𐐀 Name')).toBe('𐐀N');
  expect(initials(' ')).toBe('?');
  expect(avatarTone('person-1')).toBe(avatarTone('person-1'));
  expect(
    new Set(Array.from({ length: 30 }, (_, index) => avatarTone(`person-${index}`))).size,
  ).toBe(5);
  render(<Avatar name=" " userId="anonymous" />);
  expect(screen.getByRole('img', { name: 'Unknown person' }).textContent).toBe('?');
});
const people = [
  { userId: 'a', name: 'Adam Nowak' },
  { userId: 'k', name: 'Kasia Wiśniewska' },
  { userId: 'm', name: 'Michał Kowalczyk' },
  { userId: 'j', name: 'Jan Nowak' },
  { userId: 'o', name: 'Ola Kowalska' },
];
it('collapses overflow without losing its names, and shows no overflow below the limit', () => {
  const { rerender } = render(<AvatarStack people={people} />);
  expect(screen.getByRole('group', { name: 'People' })).not.toBeNull();
  expect(screen.getAllByRole('img')).toHaveLength(4);
  expect(
    screen.getByRole('img', { name: '2 more people: Jan Nowak, Ola Kowalska' })
      .textContent,
  ).toBe('+2');
  rerender(<AvatarStack people={people} limit={5} size="lg" label="Collaborators" />);
  expect(screen.getAllByRole('img')).toHaveLength(5);
  expect(screen.queryByText(/\+/)).toBeNull();
  rerender(<AvatarStack people={[]} />);
  expect(screen.queryByRole('img')).toBeNull();
});
it.each([0, -1, 1.5, NaN])('rejects invalid avatar stack limit %s', (limit) => {
  expect(() => render(<AvatarStack people={people} limit={limit} />)).toThrow(
    'positive integer',
  );
});
it('renders base-color stickers with words and optional icons', () => {
  const { rerender } = render(<Sticker label="Grounded in 12 sources" icon="sparkle" />);
  expect(screen.getByText('Grounded in 12 sources').classList.contains('yellow')).toBe(
    true,
  );
  expect(screen.getByText('Grounded in 12 sources').querySelector('svg')).not.toBeNull();
  rerender(<Sticker label="New evidence" tone="blue" />);
  expect(screen.getByText('New evidence').classList.contains('blue')).toBe(true);
  expect(screen.getByText('New evidence').querySelector('svg')).toBeNull();
});
