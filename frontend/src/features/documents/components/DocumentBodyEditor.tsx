import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';

import {
  documentExtensions,
  savedDocumentOf,
  type ProseMirrorDocument,
} from '../api/documentContent';

interface DocumentBodyEditorProps {
  /**
   * The document to open. Read once, when the editor is created.
   *
   * Later changes to this prop are ignored on purpose, and nothing here calls `setContent`. The only way to show
   * a different document is to remount the component, which the page does when the user explicitly asks for the
   * latest version. A refetch, a failed save, or a conflict never replaces what somebody is typing.
   */
  readonly initialContent: ProseMirrorDocument;
  /** Whether the body can be changed. `false` hides the toolbar and makes the editor read-only. */
  readonly editable: boolean;
  /** Receives `getJSON()` after every change. This is the value a save sends. */
  readonly onChange: (content: ProseMirrorDocument) => void;
  /** Id of the visible element that names the editor. Either this or `label`. */
  readonly labelId?: string;
  /** The editor's accessible name, when no visible element names it. */
  readonly label?: string;
  /** Id of the element describing a validation error on the body, when there is one. */
  readonly errorId?: string;
}

/**
 * The document body: a Tiptap editor over the stored ProseMirror JSON, with a small formatting toolbar.
 *
 * Tiptap owns the document while the page is open; the parent owns saving. Every change is reported as
 * `getJSON()`, never HTML, so what the parent PATCHes is the same tree the backend stores.
 *
 * There is no collaboration extension. Yjs would replace the save transport later (docs/context.md section 9),
 * and it can, because the boundary here is only "a ProseMirror document goes out".
 */
export function DocumentBodyEditor({
  initialContent,
  editable,
  onChange,
  labelId,
  label,
  errorId,
}: DocumentBodyEditorProps): ReactElement {
  // Read through a ref, so a new callback from the parent does not need a new editor.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // The editable element is a div, so the accessible name and state are set on it directly. Memoised so the
  // editor is only told about a real change.
  const editorProps = useMemo(
    () => ({
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        ...(labelId === undefined ? {} : { 'aria-labelledby': labelId }),
        ...(label === undefined ? {} : { 'aria-label': label }),
        'aria-readonly': String(!editable),
        'aria-invalid': String(errorId !== undefined),
        ...(errorId === undefined ? {} : { 'aria-describedby': errorId }),
      },
    }),
    [labelId, label, editable, errorId],
  );

  const editor = useEditor({
    extensions: documentExtensions,
    content: initialContent,
    editable,
    editorProps,
    onUpdate: ({ editor: changed }) => {
      onChangeRef.current(savedDocumentOf(changed));
    },
  });

  // useEditor keeps an existing editor's editable flag when options change, so it is applied here. Without
  // emitting an update: becoming read-only is not an edit.
  useEffect(() => {
    if (editor.isEditable !== editable) {
      editor.setEditable(editable, false);
    }
  }, [editor, editable]);

  return (
    <div>
      {editable ? <DocumentToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Formatting controls. Each button runs one Tiptap command, so everything they produce is a node or mark in the
 * schema and survives a save.
 */
function DocumentToolbar({ editor }: { readonly editor: Editor }): ReactElement {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      inTable: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  return (
    <div role="toolbar" aria-label="Formatting">
      <ToggleButton
        label="Bold"
        pressed={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToggleButton
        label="Italic"
        pressed={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToggleButton
        label="Heading 1"
        pressed={state.heading1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToggleButton
        label="Heading 2"
        pressed={state.heading2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToggleButton
        label="Bullet list"
        pressed={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToggleButton
        label="Numbered list"
        pressed={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <button
        type="button"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        Insert table
      </button>
      <button
        type="button"
        disabled={!state.inTable}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        Add row
      </button>
      <button
        type="button"
        disabled={!state.inTable}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        Add column
      </button>
      <button
        type="button"
        disabled={!state.inTable}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        Delete table
      </button>
      <button
        type="button"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        Redo
      </button>
    </div>
  );
}

function ToggleButton({
  label,
  pressed,
  onClick,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}
