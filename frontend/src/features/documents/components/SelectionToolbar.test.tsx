/** @jest-environment jsdom */
import { savedDocumentOf } from '../api/documentContent';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { DocumentBodyEditor } from './DocumentBodyEditor';
import { SELECTION_ACTIONS } from '../../ai/api/authoringActions';
import type { ProseMirrorDocument } from '../api/documentContent';

const content: ProseMirrorDocument = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Human claim.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Next paragraph.' }] },
  ],
};
const onChange = jest.fn();
const onAction = jest.fn();
function editor(): Editor {
  return (
    screen.getByRole('textbox', { name: 'Text' }) as HTMLElement & { editor: Editor }
  ).editor;
}
function view(props: Partial<Parameters<typeof DocumentBodyEditor>[0]> = {}) {
  return (
    <DocumentBodyEditor
      initialContent={content}
      editable
      selectionActionsEnabled
      onSelectionAction={onAction}
      onChange={onChange}
      label="Text"
      {...props}
    />
  );
}
function select(from = 1, to = 13) {
  act(() => {
    editor().commands.setTextSelection({ from, to });
  });
}
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect(150, 200, 100, 20);
  Range.prototype.getClientRects = () =>
    [new DOMRect(150, 200, 100, 20)] as unknown as DOMRectList;
});
beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

test.each(SELECTION_ACTIONS)(
  '%s operates on the live selection without changing the document',
  (action, label) => {
    render(view());
    expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
    select();
    const toolbar = screen.getByRole('toolbar', { name: /AI actions/ });
    expect(within(toolbar).getAllByRole('button')).toHaveLength(5);
    expect(
      within(toolbar).queryByRole('button', {
        name: /Clarify|Fix grammar|Check claim|Add citation/,
      }),
    ).toBeNull();
    fireEvent.mouseDown(within(toolbar).getByRole('button', { name: label }));
    fireEvent.click(within(toolbar).getByRole('button', { name: label }));
    expect(onAction).toHaveBeenCalledWith(action, {
      from: 1,
      to: 13,
      text: 'Human claim.',
      placementBlock: 1,
    });
    expect(savedDocumentOf(editor())).toEqual(content);
    expect(onChange).not.toHaveBeenCalled();
  },
);

test('Tab and Alt+F10 reach actions; arrow keys, Home, End and Escape preserve the selection', () => {
  render(view());
  select();
  const body = screen.getByRole('textbox', { name: 'Text' });
  const toolbar = screen.getByRole('toolbar', { name: /AI actions/ });
  const buttons = within(toolbar).getAllByRole('button');
  fireEvent.keyDown(body, { key: 'Tab' });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0]!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(buttons[4]);
  fireEvent.keyDown(buttons[4]!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0]!, { key: 'End' });
  expect(document.activeElement).toBe(buttons[4]);
  fireEvent.keyDown(buttons[4]!, { key: 'Home' });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(body, { key: 'F10', altKey: true });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0]!, { key: 'Escape' });
  expect(editor().state.selection.from).toBe(1);
  expect(editor().state.selection.to).toBe(13);
  expect(onChange).not.toHaveBeenCalled();
});

test('viewer, unsettled state, empty and excessive selections do not expose AI actions', () => {
  const rendered = render(view());
  select();
  rendered.rerender(view({ editable: false }));
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
  rendered.rerender(view({ selectionActionsEnabled: false }));
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
  rendered.rerender(view());
  select(1, 1);
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
  act(() => {
    editor().commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(2001) }] },
      ],
    });
  });
  select(1, 2002);
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
});

test('toolbar repositions with scroll and resize and unmounts on a collapsed range', () => {
  render(view());
  select();
  const toolbar = screen.getByRole('toolbar', { name: /AI actions/ });
  expect(toolbar.style.top).toBe('192px');
  expect(toolbar.style.left).toBe('200px');
  fireEvent.scroll(window);
  fireEvent.resize(window);
  expect(toolbar.style.top).toBe('192px');
  select(1, 1);
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
});

test('focusing another control hides the toolbar; returning to the selection restores it', () => {
  render(view());
  select();
  const toolbar = screen.getByRole('toolbar', { name: /AI actions/ });
  act(() => within(toolbar).getByRole('button', { name: 'Shorten' }).focus());
  expect(screen.getByRole('toolbar', { name: /AI actions/ })).toBeTruthy();
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  act(() => outside.focus());
  expect(screen.queryByRole('toolbar', { name: /AI actions/ })).toBeNull();
  act(() => screen.getByRole('textbox', { name: 'Text' }).focus());
  expect(screen.getByRole('toolbar', { name: /AI actions/ })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  outside.remove();
});

test('draft decoration occupies the requested block boundary while JSON and save callbacks stay untouched', () => {
  const host = document.createElement('div');
  host.contentEditable = 'false';
  host.textContent = 'Unaccepted AI draft';
  const rendered = render(view({ draftHost: host, draftPlacement: 1 }));
  const body = screen.getByRole('textbox', { name: 'Text' });
  expect(body.children[1]).toBe(host);
  const button = document.createElement('button');
  host.appendChild(button);
  fireEvent.keyDown(button, { key: 'Enter' });
  expect(savedDocumentOf(editor())).toEqual(content);
  expect(onChange).not.toHaveBeenCalled();
  rendered.rerender(view({ draftHost: host, draftPlacement: 0 }));
  expect(body.firstElementChild).toBe(host);
  expect(savedDocumentOf(editor())).toEqual(content);
  rendered.rerender(view({ draftHost: host, draftPlacement: null }));
  expect(body.contains(host)).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});

test('Insert and edit focuses the accepted block without producing another save', () => {
  render(view({ focusBlock: 1 }));
  expect(editor().state.selection.from).toBe(15);
  expect(savedDocumentOf(editor())).toEqual(content);
  expect(onChange).not.toHaveBeenCalled();
});
test('rewrite review follows the final selected block, including a multi-block selection, without changing JSON', () => {
  const host = document.createElement('div');
  host.contentEditable = 'false';
  const rendered = render(
    view({ draftHost: host, draftPlacement: 1, reviewSelectionEnd: 17 }),
  );
  const body = screen.getByRole('textbox', { name: 'Text' });
  expect(body.lastElementChild).toBe(host);
  expect(savedDocumentOf(editor())).toEqual(content);
  expect(onChange).not.toHaveBeenCalled();
  rendered.rerender(
    view({ draftHost: host, draftPlacement: 1, reviewSelectionEnd: 10000 }),
  );
  expect(body.lastElementChild).toBe(host);
  expect(savedDocumentOf(editor())).toEqual(content);
});
