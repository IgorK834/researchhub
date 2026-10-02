/** @jest-environment jsdom */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { Button, type ButtonVariant, type ButtonSize } from './Button';
import '../../styles/index.css';

it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger', 'danger-soft'])(
  'renders the %s variant as a native, non-submit button',
  (variant) => {
    render(<Button variant={variant}>Create workspace</Button>);
    const button = screen.getByRole('button', { name: 'Create workspace' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains(variant)).toBe(true);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  },
);

it.each<ButtonSize>(['compact', 'default', 'large'])('supports the %s size', (size) => {
  render(<Button size={size}>Download</Button>);
  expect(screen.getByRole('button').classList.contains(size)).toBe(true);
});

it('forwards native props, submit behavior, classes and a button ref', () => {
  const submit = jest.fn((event) => event.preventDefault());
  const click = jest.fn();
  const ref = createRef<HTMLButtonElement>();
  render(
    <form onSubmit={submit}>
      <Button
        type="submit"
        name="action"
        value="save"
        className="custom"
        ref={ref}
        onClick={click}
      >
        Save
      </Button>
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(ref.current?.value).toBe('save');
  expect(ref.current?.classList.contains('custom')).toBe(true);
});

it('does not activate a disabled button', () => {
  const click = jest.fn();
  render(
    <Button disabled onClick={click}>
      Remove
    </Button>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole('button')).toHaveProperty('disabled', true);
});

it('renders a decorative leading icon without changing the accessible name', () => {
  render(<Button icon="plus">New document</Button>);
  const button = screen.getByRole('button', { name: 'New document' });
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});

it('names an icon-only button and rejects a blank action name at runtime', () => {
  render(<Button iconOnly icon="download" aria-label="Download source" />);
  expect(
    screen
      .getByRole('button', { name: 'Download source' })
      .classList.contains('iconOnly'),
  ).toBe(true);
  expect(() => render(<Button iconOnly icon="download" aria-label="  " />)).toThrow(
    'non-empty aria-label',
  );
});

it('keeps rich idle content mounted and named while busy, and blocks repeat actions', () => {
  const click = jest.fn();
  const { rerender } = render(
    <Button icon="play" onClick={click}>
      <strong>Run analysis</strong>
    </Button>,
  );
  const originalContent = screen.getByText('Run analysis');
  rerender(
    <Button icon="play" busy busyLabel="Running…" onClick={click}>
      <strong>Run analysis</strong>
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Run analysis' });
  expect(screen.getByText('Run analysis')).toBe(originalContent);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.getAttribute('data-busy')).toBe('true');
  expect(screen.getByText('Running…').getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
  rerender(<Button onClick={click}>Run analysis</Button>);
  fireEvent.click(screen.getByRole('button'));
  expect(click).toHaveBeenCalledTimes(1);
});

it('keeps an icon-only action named while busy without adding progress text', () => {
  render(
    <Button
      iconOnly
      icon="refresh"
      aria-label="Refresh sources"
      busy
      busyLabel="Refreshing…"
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Refresh sources' }).getAttribute('aria-busy'),
  ).toBe('true');
  expect(screen.queryByText('Refreshing…')).toBeNull();
});

it('renders and activates a native link with anchor props and a ref', () => {
  const click = jest.fn((event) => event.preventDefault());
  const ref = createRef<HTMLAnchorElement>();
  render(
    <Button href="/guide" target="_blank" rel="noreferrer" ref={ref} onClick={click}>
      Guide
    </Button>,
  );
  const link = screen.getByRole('link', { name: 'Guide' });
  expect(link.tagName).toBe('A');
  expect(link.getAttribute('href')).toBe('/guide');
  expect(ref.current?.target).toBe('_blank');
  fireEvent.click(link);
  expect(click).toHaveBeenCalledTimes(1);
});

it('allows an ordinary link without a click handler and preserves tabIndex', () => {
  render(
    <Button href="#guide" tabIndex={2}>
      Guide
    </Button>,
  );
  const link = screen.getByRole('link');
  expect(link.tabIndex).toBe(2);
  fireEvent.click(link);
});

it.each([{ disabled: true }, { busy: true }])('blocks unavailable links: %o', (state) => {
  const click = jest.fn();
  render(
    <Button href="/guide" onClick={click} {...state}>
      Guide
    </Button>,
  );
  const link = screen.getByRole('link', { name: 'Guide' });
  expect(link.getAttribute('aria-disabled')).toBe('true');
  expect(link.hasAttribute('href')).toBe(false);
  expect(link.tabIndex).toBe(-1);
  expect(fireEvent.click(link)).toBe(false);
  expect(click).not.toHaveBeenCalled();
});
