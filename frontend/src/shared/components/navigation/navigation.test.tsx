/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { Tabs, FilterChip, Breadcrumb, type TabItem } from './index';

const items: readonly TabItem<string>[] = [
  { value: 'all', label: 'All', count: 12, content: <p>All sources</p> },
  {
    value: 'images',
    label: 'Images',
    count: 0,
    disabled: true,
    content: <p>Images unavailable</p>,
  },
  { value: 'pdf', label: 'PDF', count: 6, content: <p>PDF sources</p> },
  { value: 'text', label: 'Text', content: <p>Text sources</p> },
];
function Example({
  orientation = 'horizontal',
}: {
  readonly orientation?: 'horizontal' | 'vertical';
}) {
  const [value, setValue] = useState('all');
  return (
    <Tabs
      label="Source types"
      items={items}
      value={value}
      onChange={setValue}
      orientation={orientation}
    />
  );
}

it('associates selected tabs and panels, preserves inactive panel state and exposes counts', () => {
  render(<Example />);
  const all = screen.getByRole('tab', { name: 'All 12' });
  const panel = screen.getByRole('tabpanel', { name: 'All 12' });
  expect(all.getAttribute('aria-controls')).toBe(panel.id);
  expect(panel.getAttribute('aria-labelledby')).toBe(all.id);
  expect(all.getAttribute('aria-selected')).toBe('true');
  expect(all.tabIndex).toBe(0);
  expect(screen.getByRole('tab', { name: 'Images 0' }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'PDF 6' }));
  expect(screen.getByRole('tabpanel', { name: 'PDF 6' })).toBeTruthy();
  expect(panel.hidden).toBe(true);
});

it('wraps horizontal arrows, skips disabled tabs and implements Home and End', () => {
  render(<Example />);
  const all = screen.getByRole('tab', { name: 'All 12' });
  const pdf = screen.getByRole('tab', { name: 'PDF 6' });
  const text = screen.getByRole('tab', { name: 'Text' });
  all.focus();
  fireEvent.keyDown(all, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(pdf);
  expect(pdf.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(pdf, { key: 'End' });
  expect(document.activeElement).toBe(text);
  fireEvent.keyDown(text, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(all);
  fireEvent.keyDown(all, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(text);
  fireEvent.keyDown(text, { key: 'Home' });
  expect(document.activeElement).toBe(all);
  fireEvent.keyDown(all, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(all);
});

it('supports vertical arrows and a safe focus fallback when the selected option disappears', () => {
  const { rerender } = render(<Example orientation="vertical" />);
  const all = screen.getByRole('tab', { name: 'All 12' });
  fireEvent.keyDown(all, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'PDF 6' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(all);
  rerender(<Tabs label="Sources" items={items} value="gone" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'All 12' }).tabIndex).toBe(0);
  rerender(
    <Tabs
      label="Sources"
      items={items.map((item) => ({ ...item, disabled: true }))}
      value="all"
      onChange={() => {}}
    />,
  );
  expect(screen.queryByRole('tabpanel')).toBeNull();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'All 12' }), { key: 'ArrowRight' });
});

it('makes filter chips native named toggle buttons and forwards native props', () => {
  const click = jest.fn();
  const { rerender } = render(
    <FilterChip label="Ready" count={9} active onClick={click} className="custom" />,
  );
  const button = screen.getByRole('button', { name: 'Ready 9' });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('type')).toBe('button');
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
  rerender(<FilterChip label="Failed" active={false} disabled type="submit" />);
  expect(
    screen.getByRole('button', { name: 'Failed' }).getAttribute('aria-pressed'),
  ).toBe('false');
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
});

it('labels its nav, retains full names and marks only the final breadcrumb as current', () => {
  const longName = 'Electronics Lab — Team 4 — A very long workspace name';
  const { rerender } = render(
    <Breadcrumb
      segments={[
        { label: longName, href: '/workspace' },
        { label: 'Sources' },
        { label: 'smith_2025.pdf', href: '/ignored' },
      ]}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(screen.getByRole('link', { name: longName }).getAttribute('title')).toBe(
    longName,
  );
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('smith_2025.pdf');
  expect(screen.queryByRole('link', { name: 'smith_2025.pdf' })).toBeNull();
  expect(nav.querySelectorAll('svg')).toHaveLength(2);
  rerender(
    <Breadcrumb
      label="Location"
      segments={[{ label: 'Home', href: '/app' }, { label: 'Current' }]}
      renderLink={(segment) => (
        <a href={segment.href} data-testid="custom">
          {segment.label}
        </a>
      )}
    />,
  );
  expect(screen.getByRole('navigation', { name: 'Location' })).toBeTruthy();
  expect(screen.getByTestId('custom').getAttribute('href')).toBe('/app');
});
