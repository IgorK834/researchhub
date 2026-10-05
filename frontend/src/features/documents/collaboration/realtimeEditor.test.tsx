/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { documentExtensions, EMPTY_DOCUMENT } from '../api/documentContent';
import { prepareEmptyText } from './emptyText';
import { DocumentBodyEditor } from '../components/DocumentBodyEditor';

it('binds two visible editors to Yjs without duplicate seeding and synchronizes formatting and undo', () => {
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Shared paragraph' }] },
    ],
  };
  const a = prosemirrorJSONToYDoc(getSchema(documentExtensions), content, 'default');
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.on('update', (update, origin) => {
    if (origin !== b) Y.applyUpdate(b, update, a);
  });
  b.on('update', (update, origin) => {
    if (origin !== a) Y.applyUpdate(a, update, b);
  });
  const changed = jest.fn();
  const view = render(
    <>
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={a}
        editable
        onChange={changed}
        label="Author A"
      />
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={b}
        editable
        onChange={changed}
        label="Author B"
      />
    </>,
  );
  expect(screen.getByRole('textbox', { name: 'Author A' }).textContent).toBe(
    'Shared paragraph',
  );
  expect(screen.getByRole('textbox', { name: 'Author B' }).textContent).toBe(
    'Shared paragraph',
  );
  act(() => fireEvent.click(screen.getAllByRole('button', { name: 'Heading 1' })[0]!));
  expect(
    screen.getByRole('textbox', { name: 'Author A' }).querySelector('h1'),
  ).not.toBeNull();
  expect(
    screen.getByRole('textbox', { name: 'Author B' }).querySelector('h1'),
  ).not.toBeNull();
  act(() => fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!));
  expect(
    screen.getByRole('textbox', { name: 'Author B' }).querySelector('h1'),
  ).toBeNull();
  expect(changed).toHaveBeenCalled();
  view.unmount();
  a.destroy();
  b.destroy();
});

it('undo removes only local text after concurrent insertions into the same empty paragraph', () => {
  const a = prosemirrorJSONToYDoc(
    getSchema(documentExtensions),
    EMPTY_DOCUMENT,
    'default',
  );
  prepareEmptyText(a, getSchema(documentExtensions));
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const view = render(
    <>
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={a}
        editable
        onChange={jest.fn()}
        label="Author A"
      />
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={b}
        editable
        onChange={jest.fn()}
        label="Author B"
      />
    </>,
  );
  const editorA = (
    screen.getByRole('textbox', { name: 'Author A' }) as HTMLElement & {
      editor: import('@tiptap/core').Editor;
    }
  ).editor;
  const editorB = (
    screen.getByRole('textbox', { name: 'Author B' }) as HTMLElement & {
      editor: import('@tiptap/core').Editor;
    }
  ).editor;
  act(() => {
    editorA.commands.insertContent('ALPHA');
    editorB.commands.insertContent('BETA');
  });
  act(() => {
    const updateA = Y.encodeStateAsUpdate(a),
      updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB, b);
    Y.applyUpdate(b, updateA, a);
  });
  expect(editorA.getText()).toContain('ALPHA');
  expect(editorA.getText()).toContain('BETA');
  act(() => fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!));
  expect(editorA.getText()).not.toContain('ALPHA');
  expect(editorA.getText()).toContain('BETA');
  view.unmount();
  a.destroy();
  b.destroy();
});

it('prepares newly created paragraphs before concurrent typing and keeps the other author’s text on undo', () => {
  const a = prosemirrorJSONToYDoc(
    getSchema(documentExtensions),
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start' }] }],
    },
    'default',
  );
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const view = render(
    <>
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={a}
        editable
        onChange={jest.fn()}
        label="Author A"
      />
      <DocumentBodyEditor
        initialContent={EMPTY_DOCUMENT}
        collaborationDocument={b}
        editable
        onChange={jest.fn()}
        label="Author B"
      />
    </>,
  );
  const editorA = (
    screen.getByRole('textbox', { name: 'Author A' }) as HTMLElement & {
      editor: import('@tiptap/core').Editor;
    }
  ).editor;
  const editorB = (
    screen.getByRole('textbox', { name: 'Author B' }) as HTMLElement & {
      editor: import('@tiptap/core').Editor;
    }
  ).editor;
  act(() => editorA.commands.insertContentAt(7, { type: 'paragraph' }));
  expect((a.getXmlFragment('default').get(1) as Y.XmlElement).get(0)).toBeInstanceOf(
    Y.XmlText,
  );
  act(() => Y.applyUpdate(b, Y.encodeStateAsUpdate(a), a));
  act(() => {
    editorA.commands.insertContentAt(8, 'ALPHA');
    editorB.commands.insertContentAt(8, 'BETA');
  });
  act(() => {
    const updateA = Y.encodeStateAsUpdate(a),
      updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB, b);
    Y.applyUpdate(b, updateA, a);
  });
  act(() => fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!));
  expect(editorA.getText()).not.toContain('ALPHA');
  expect(editorA.getText()).toContain('BETA');
  view.unmount();
  a.destroy();
  b.destroy();
});

it('renders a peer caret and selected text as ephemeral decorations and removes them without editing the document', async () => {
  const {
    Awareness,
    encodeAwarenessUpdate,
    applyAwarenessUpdate,
    removeAwarenessStates,
  } = jest.requireActual<typeof import('y-protocols/awareness')>('y-protocols/awareness');
  const a = prosemirrorJSONToYDoc(
    getSchema(documentExtensions),
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Shared paragraph' }] },
      ],
    },
    'default',
  );
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const awarenessA = new Awareness(a),
    awarenessB = new Awareness(b);
  const changed = jest.fn();
  const view = render(
    <DocumentBodyEditor
      initialContent={EMPTY_DOCUMENT}
      collaborationDocument={b}
      collaborationProvider={
        { awareness: awarenessB } as import('@hocuspocus/provider').HocuspocusProvider
      }
      collaborationUser={{ userId: 'b', displayName: 'Ben', colorId: 'coral' }}
      editable
      onChange={changed}
      label="Shared editor"
    />,
  );
  const dom = screen.getByRole('textbox', { name: 'Shared editor' }) as HTMLElement & {
    editor: import('@tiptap/core').Editor;
  };
  const before = dom.editor.getJSON();
  changed.mockClear();
  act(() => {
    awarenessA.setLocalStateField('user', {
      userId: 'a',
      displayName: 'Ada',
      colorId: 'blue',
    });
    const text = (a.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    awarenessA.setLocalStateField('cursor', {
      anchor: Y.createRelativePositionFromTypeIndex(text, 2),
      head: Y.createRelativePositionFromTypeIndex(text, 7),
    });
    applyAwarenessUpdate(
      awarenessB,
      encodeAwarenessUpdate(awarenessA, [a.clientID]),
      null,
    );
  });
  await waitFor(() =>
    expect(dom.querySelector('.collaboration-carets__label')?.textContent).toBe('Ada'),
  );
  expect(dom.querySelector('.collaboration-carets__selection')?.textContent).toBe(
    'ared ',
  );
  expect(dom.editor.getJSON()).toEqual(before);
  expect(changed).not.toHaveBeenCalled();
  act(() => removeAwarenessStates(awarenessB, [a.clientID], null));
  await waitFor(() =>
    expect(dom.querySelector('.collaboration-carets__label')).toBeNull(),
  );
  expect(dom.editor.getJSON()).toEqual(before);
  view.unmount();
  awarenessA.destroy();
  awarenessB.destroy();
  a.destroy();
  b.destroy();
});
