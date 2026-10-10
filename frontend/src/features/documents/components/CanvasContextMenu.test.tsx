/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { DocumentBodyEditor } from './DocumentBodyEditor';
let editor: Editor;
beforeEach(() => {
  Object.defineProperty(globalThis, 'ClipboardEvent', {
    configurable: true,
    value: class extends Event {
      clipboardData = null;
    },
  });
  window.scrollBy = jest.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: jest.fn().mockResolvedValue(undefined),
      readText: jest.fn().mockResolvedValue('<b>plain</b>'),
    },
  });
});
function open(editable = true, ask = jest.fn()) {
  const view = render(
    <DocumentBodyEditor
      initialContent={{
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc def' }] }],
      }}
      editable={editable}
      onChange={() => {}}
      label="Canvas"
      onEditorReady={(value) => {
        if (value) editor = value;
      }}
      onCanvasAi={ask}
    />,
  );
  jest
    .spyOn(editor.view, 'coordsAtPos')
    .mockReturnValue({ left: 30, top: 30, right: 31, bottom: 50 });
  act(() => editor.commands.setTextSelection({ from: 1, to: 4 }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Canvas' }), {
    key: 'F10',
    shiftKey: true,
  });
  return { view, ask };
}
it('keyboard menu supports arrows/Home/End, Ask AI and escape focus without changing selection', () => {
  const { ask } = open();
  expect(
    (screen.getByRole('menuitem', { name: 'Undo' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Ask AI' }));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Bullet list' }),
  );
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Cut' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Ask AI' }));
  expect(ask).toHaveBeenCalled();
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(4);
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Canvas' }), {
    key: 'F10',
    shiftKey: true,
  });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(editor.view.dom);
});
it('viewer sees only copy and Ask AI; formatting actions use editor history', async () => {
  const first = open(false);
  expect(screen.queryByRole('menuitem', { name: 'Cut' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Undo' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc'));
  first.view.unmount();
  open();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Bold' }));
  expect(editor.isActive('bold')).toBe(true);
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Undo' }));
  expect(editor.isActive('bold')).toBe(false);
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Redo' }));
  expect(editor.isActive('bold')).toBe(true);
});
it('clipboard rejection retains content and successful cut/paste go through the schema', async () => {
  open();
  (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
  await screen.findByText(/text is retained/);
  expect(editor.getText()).toBe('abc def');
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
  await waitFor(() => expect(editor.getText()).toBe(' def'));
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await waitFor(() => expect(editor.getText()).toContain('<b>plain</b>'));
  expect(editor.getHTML()).toContain('&lt;b&gt;');
  (navigator.clipboard.readText as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await screen.findByText(/Ctrl\/Cmd\+V/);
});
it('maps a pinned selection and refuses a changed cut while clipboard write is pending', async () => {
  open();
  let finish!: () => void;
  (navigator.clipboard.writeText as jest.Mock).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cut' }));
  act(() => editor.commands.insertContentAt({ from: 1, to: 4 }, 'changed'));
  await act(async () => finish());
  expect(editor.getText()).toBe('changed def');
  await screen.findByText(/text is retained/);
});
it('right-click keeps selection inside it and places a caret outside it, while textareas stay native', () => {
  open();
  fireEvent.keyDown(document, { key: 'Escape' });
  jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 0 });
  fireEvent.contextMenu(editor.view.dom, { clientX: 20, clientY: 20 });
  expect(editor.state.selection.to).toBe(4);
  fireEvent.keyDown(document, { key: 'Escape' });
  jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 6, inside: 0 });
  fireEvent.contextMenu(editor.view.dom, { clientX: 40, clientY: 20 });
  expect(editor.state.selection.from).toBe(6);
  expect(editor.state.selection.empty).toBe(true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Italic' }));
  expect(editor.isActive('italic')).toBe(true);
});
it.each(['Heading', 'Bullet list', 'Delete selection'])(
  'runs %s on the pinned selection',
  (name) => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name }));
    expect(editor.getText().trim()).toBe(name === 'Delete selection' ? 'def' : 'abc def');
  },
);
it('copies structured clipboard data and reports denied copy without changing text', async () => {
  open();
  const write = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator.clipboard, 'write', {
    configurable: true,
    value: write,
  });
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: class {
      constructor(readonly data: unknown) {}
    },
  });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
  await waitFor(() => expect(write).toHaveBeenCalled());
  expect(editor.getText()).toBe('abc def');
  write.mockRejectedValueOnce(new Error('denied'));
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
  await screen.findByText(/Ctrl\/Cmd\+C/);
  expect(editor.getText()).toBe('abc def');
  Reflect.deleteProperty(globalThis, 'ClipboardItem');
});
it('does not paste empty clipboard text and preserves blank lines in a multiline paste', async () => {
  open();
  (navigator.clipboard.readText as jest.Mock).mockResolvedValueOnce('');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await waitFor(() => expect(navigator.clipboard.readText).toHaveBeenCalled());
  expect(editor.getText()).toBe('abc def');
  (navigator.clipboard.readText as jest.Mock).mockResolvedValueOnce('one\n\nthree');
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await waitFor(() => expect(editor.getText()).toContain('three'));
  expect(editor.getText()).toContain('one\n\nthree');
});
it('refuses a paste when the target changes during clipboard permission resolution', async () => {
  open();
  let finish!: (text: string) => void;
  (navigator.clipboard.readText as jest.Mock).mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  act(() => editor.commands.insertContentAt({ from: 1, to: 4 }, 'changed'));
  await act(async () => finish('clipboard'));
  expect(editor.getText()).toBe('changed def');
  await screen.findByText(/Ctrl\/Cmd\+V/);
});
it('uses native schema paste for rich text and citations and ignores executable markup', async () => {
  open();
  const citation = {
    workspaceId: crypto.randomUUID(),
    sourceId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    chunkId: 'a'.repeat(64),
    processingVersion: 'v1',
    spans: [],
    pageStart: null,
    pageEnd: null,
    sectionTitle: null,
  };
  act(() =>
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'researchCitation', attrs: { citation, number: '1' } }],
        },
      ],
    }),
  );
  const html =
    editor.getHTML() +
    '<script>throw new Error("unsafe")</script><p><strong>Rich text</strong></p>';
  Object.defineProperty(navigator.clipboard, 'read', {
    configurable: true,
    value: jest
      .fn()
      .mockResolvedValue([
        { types: ['text/html'], getType: async () => ({ text: async () => html }) },
      ]),
  });
  act(() =>
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }),
  );
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await waitFor(() => expect(editor.getHTML()).toContain('<strong>Rich text</strong>'));
  expect(editor.getHTML()).not.toContain('<script>');
  expect(JSON.stringify(editor.getJSON())).toContain(citation.sourceId);
  expect(
    editor.getJSON().content!.some((node) => node.attrs?.['originIntent'] === 'IMPORTED'),
  ).toBe(true);
  (navigator.clipboard.read as jest.Mock).mockResolvedValueOnce([
    {
      types: ['text/plain'],
      getType: async () => ({ text: async () => 'plain fallback' }),
    },
  ]);
  fireEvent.keyDown(editor.view.dom, { key: 'F10', shiftKey: true });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
  await waitFor(() => expect(editor.getText()).toContain('plain fallback'));
});
