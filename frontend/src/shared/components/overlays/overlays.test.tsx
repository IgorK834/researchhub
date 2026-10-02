/** @jest-environment jsdom */
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { Dialog, SlideOver, Menu, Popover, type MenuItem } from './index';
import { tabbables } from './useOverlay';

let resize: ResizeObserverCallback;
const originalResize = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});
afterEach(() => {
  globalThis.ResizeObserver = originalResize;
});

function ModalExample({
  slide = false,
  dismissible = true,
}: {
  slide?: boolean;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const initial = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const Surface = slide ? SlideOver : Dialog;
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Open panel
      </button>
      <button>Outside</button>
      <Surface
        open={open}
        onClose={() => setOpen(false)}
        title="Context"
        description="Source context"
        initialFocusRef={initial}
        returnFocusRef={trigger}
        dismissible={dismissible}
        footer={<button onClick={() => setOpen(false)}>Done</button>}
      >
        <input aria-label="Caption" ref={initial} />
        <button disabled>Disabled</button>
        <button hidden>Hidden</button>
        <a href="/source">Open source</a>
      </Surface>
    </>
  );
}

it.each([false, true])(
  'traps focus in %s slide-over, applies modal semantics and returns focus on Escape',
  (slide) => {
    document.body.style.overflow = 'scroll';
    const { container } = render(<ModalExample slide={slide} />);
    const trigger = screen.getByRole('button', { name: 'Open panel' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Context' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent,
    ).toBe('Source context');
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(container.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('link'));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('link'));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  },
);

it('requires an explicit close on non-dismissible confirmations', () => {
  render(<ModalExample dismissible={false} />);
  fireEvent.click(screen.getByText('Open panel'));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.pointerDown(dialog.parentElement!);
  expect(screen.getByRole('dialog')).toBe(dialog);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('dismisses the scrim, contains escaped programmatic focus and restores pre-existing inertness', async () => {
  const preserved = document.createElement('div');
  preserved.setAttribute('inert', '');
  document.body.append(preserved);
  const { container } = render(<ModalExample />);
  fireEvent.click(screen.getByText('Open panel'));
  const dialog = screen.getByRole('dialog');
  act(() => {
    within(container).getByText('Outside').focus();
  });
  expect(dialog.contains(document.activeElement)).toBe(true);
  const later = document.createElement('button');
  await act(async () => {
    document.body.append(later);
  });
  expect(later.hasAttribute('inert')).toBe(true);
  fireEvent.pointerDown(dialog.parentElement!);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(preserved.hasAttribute('inert')).toBe(true);
  expect(later.hasAttribute('inert')).toBe(false);
  preserved.remove();
  later.remove();
});

it('keeps the newest modal active and closes nested menus before the enclosing dialog', () => {
  function Nested() {
    const [open, setOpen] = useState(false);
    const [nested, setNested] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Launch</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Parent">
          <button onClick={() => setNested(true)}>Nested</button>
          <Menu
            label="Actions"
            items={[{ id: 'open', label: 'Read', onSelect: jest.fn() }]}
          />
        </Dialog>
        <Dialog open={nested} onClose={() => setNested(false)} title="Child">
          Details
        </Dialog>
      </>
    );
  }
  render(<Nested />);
  const trigger = screen.getByText('Launch');
  trigger.focus();
  fireEvent.click(trigger);
  const parent = screen.getByRole('dialog', { name: 'Parent' });
  const nested = within(parent).getByRole('button', { name: 'Nested' });
  nested.focus();
  fireEvent.click(nested);
  expect(parent.parentElement?.hasAttribute('inert')).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Child' }), { key: 'Escape' });
  expect(document.activeElement).toBe(nested);
  expect(parent.parentElement?.hasAttribute('inert')).toBe(false);
  const actions = screen.getByRole('button', { name: 'Actions' });
  actions.focus();
  fireEvent.click(actions);
  expect(parent.contains(screen.getByRole('menu'))).toBe(true);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('dialog')).toBe(parent);
  expect(document.activeElement).toBe(actions);
  fireEvent.keyDown(parent, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
});

it('retains focus when props update, calls the newest close handler, and tolerates a removed trigger', () => {
  const first = jest.fn();
  const second = jest.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const { rerender, unmount } = render(
    <Dialog open title="Confirm" onClose={first}>
      First
    </Dialog>,
  );
  const focused = document.activeElement;
  rerender(
    <Dialog open title="Confirm" onClose={second}>
      Updated
    </Dialog>,
  );
  expect(document.activeElement).toBe(focused);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  trigger.remove();
  unmount();
  expect(document.body.style.overflow).toBe('');
});

it.each(['outside', 'disabled', 'hidden'])(
  'falls back to an enabled dialog control for an %s initial focus target',
  (target) => {
    function Example() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={target === 'outside' ? ref : undefined}>Outside target</button>
          <Dialog open title="Confirm" onClose={() => {}} initialFocusRef={ref}>
            <button
              ref={target === 'outside' ? undefined : ref}
              disabled={target === 'disabled'}
              hidden={target === 'hidden'}
            >
              Unavailable target
            </button>
          </Dialog>
        </>
      );
    }
    render(<Example />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  },
);

it('excludes disabled, hidden, inert and negative-tabindex controls from the focus sequence', () => {
  const { container } = render(
    <div>
      <button>Visible</button>
      <button disabled>Disabled</button>
      <div hidden>
        <button>Hidden</button>
      </div>
      <div style={{ display: 'none' }}>
        <button>Not displayed</button>
      </div>
      <button style={{ visibility: 'hidden' }}>Invisible</button>
      <input tabIndex={-1} />
      <div inert>
        <button>Inert</button>
      </div>
    </div>,
  );
  expect(tabbables(container).map((element) => element.textContent)).toEqual(['Visible']);
});

const select = jest.fn();
const items: readonly MenuItem[] = [
  { id: 'open', label: 'Open', icon: 'external', shortcut: '↵', onSelect: select },
  { id: 'disabled', label: 'Disabled', disabled: true, onSelect: select },
  { id: 'rename', label: 'Rename', icon: 'pencil', shortcut: 'F2', onSelect: select },
  { id: 'rerun', label: 'Re-run', onSelect: select },
  {
    id: 'remove',
    label: 'Remove',
    icon: 'trash',
    destructive: true,
    separatorBefore: true,
    onSelect: select,
  },
];
it('opens a menu at either end, roves with arrows/Home/End, skips disabled items and supports typeahead', () => {
  render(<Menu label="Source actions" items={items} />);
  const trigger = screen.getByRole('button', { name: 'Source actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open' }));
  const key = (value: string) =>
    fireEvent.keyDown(document.activeElement!, { key: value });
  key('ArrowDown');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
  key('ArrowUp');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open' }));
  key('ArrowUp');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove' }));
  key('Home');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open' }));
  key('End');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove' }));
  key('r');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
  key('r');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Re-run' }));
  key('e');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove' }));
  key('z');
  key('Control');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove' }));
  expect(
    screen.getAllByRole('menuitem').filter((item) => item.tabIndex === 0),
  ).toHaveLength(1);
  expect(
    screen.getByRole('menuitem', { name: 'Remove' }).classList.contains('destructive'),
  ).toBe(true);
  expect(screen.getByText('F2').getAttribute('aria-hidden')).toBe('true');
  key('Escape');
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
  expect(select).toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  key('Tab');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('handles menus with no enabled items, closes on outside pointer and toggles with the trigger', () => {
  const { rerender } = render(<Menu label="Actions" items={[]} />);
  fireEvent.click(screen.getByRole('button'));
  expect(document.activeElement).toBe(screen.getByRole('menu'));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  rerender(<Menu label="Actions" items={items} />);
  const trigger = screen.getByRole('button');
  fireEvent.click(trigger);
  fireEvent.pointerDown(trigger);
  expect(screen.getByRole('menu')).not.toBeNull();
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('opens labelled non-modal popovers, repositions and leaves external focus alone', () => {
  render(
    <>
      <Popover triggerLabel="View citation" title="Smith 2025">
        <a href="/source">Read source</a>
      </Popover>
      <button>Next control</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'View citation' });
  trigger.focus();
  fireEvent.click(trigger);
  const popup = screen.getByRole('dialog', { name: 'Smith 2025' });
  expect(popup.hasAttribute('aria-modal')).toBe(false);
  expect(popup.style.left).toBe('8px');
  fireEvent(window, new Event('resize'));
  fireEvent(window, new Event('scroll'));
  act(() => resize([], {} as ResizeObserver));
  fireEvent.keyDown(popup, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Close Smith 2025' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  const link = screen.getByRole('link', { name: 'Read source' });
  act(() => link.focus());
  fireEvent.keyDown(link, { key: 'Tab' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  const next = screen.getByRole('button', { name: 'Next control' });
  act(() => next.focus());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(next);
});
