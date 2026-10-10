/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { VirtualMenu } from './VirtualMenu';
it('skips disabled items, wraps navigation and closes on Tab with an editor return target', () => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const editor = document.createElement('div');
  editor.tabIndex = 0;
  document.body.append(editor);
  const close = jest.fn(),
    select = jest.fn();
  const view = render(
    <VirtualMenu
      label="Test actions"
      returnTo={editor}
      anchor={{ getBoundingClientRect: () => new DOMRect(900, 600, 0, 0) }}
      onClose={close}
      items={[
        { id: 'disabled', label: 'Unavailable', disabled: true, onSelect: select },
        { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onSelect: select },
        {
          id: 'delete',
          label: 'Delete',
          destructive: true,
          separatorBefore: true,
          onSelect: select,
        },
      ]}
    />,
  );
  const menu = screen.getByRole('menu');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }));
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }));
  fireEvent.keyDown(menu, { key: 'x' });
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(menu, { key: 'Tab' });
  expect(close).toHaveBeenCalled();
  view.unmount();
  expect(document.activeElement).toBe(editor);
  editor.remove();
});
it('clamps an offscreen anchor to a shifted visual viewport and bounds surfaces during zoom', () => {
  const previous = window.visualViewport;
  const viewport = {
    width: 240,
    height: 200,
    offsetLeft: 20,
    offsetTop: 30,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  const size = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 190, 150));
  const editor = document.createElement('button');
  document.body.append(editor);
  const view = render(
    <VirtualMenu
      label="Zoom actions"
      returnTo={editor}
      anchor={{ getBoundingClientRect: () => new DOMRect(900, 1000, 0, 0) }}
      onClose={jest.fn()}
      items={[{ id: 'copy', label: 'Copy', onSelect: jest.fn() }]}
    />,
  );
  const menu = screen.getByRole('menu');
  expect(menu.style.left).toBe('62px');
  expect(menu.style.top).toBe('72px');
  expect(menu.style.getPropertyValue('--overlay-viewport-width')).toBe('224px');
  expect(menu.style.getPropertyValue('--overlay-viewport-height')).toBe('184px');
  view.unmount();
  expect(viewport.removeEventListener).toHaveBeenCalledWith(
    'resize',
    expect.any(Function),
  );
  editor.remove();
  size.mockRestore();
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: previous,
  });
});
