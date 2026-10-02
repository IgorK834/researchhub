import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { createPortal } from 'react-dom';

import {
  documentExtensions,
  savedDocumentOf,
  type ProseMirrorDocument,
} from '../api/documentContent';
import { documentNavigation, type DocumentNavigation } from '../api/documentNavigation';
import { Icon, type IconName } from '../../../shared/components/icons';
import styles from './DocumentPaper.module.css';

export interface AuthoringSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly placementBlock: number;
}

interface DocumentBodyEditorProps {
  readonly toolbarHost?: HTMLElement;
  readonly onNavigationChange?: (navigation: DocumentNavigation) => void;
  readonly navigationTarget?: { readonly position: number } | null;
  readonly onOpenCitation?: (path: string) => void;
  readonly onSelectionChange?: (selection: AuthoringSelection) => void;
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
  onSelectionChange,
  onOpenCitation,
  labelId,
  label,
  errorId,
  onNavigationChange,
  navigationTarget,
  toolbarHost,
}: DocumentBodyEditorProps): ReactElement {
  // Read through a ref, so a new callback from the parent does not need a new editor.
  const onChangeRef = useRef(onChange);
  const selectionRef = useRef(onSelectionChange);
  const navigationRef = useRef(onNavigationChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    selectionRef.current = onSelectionChange;
    navigationRef.current = onNavigationChange;
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
    onSelectionUpdate: ({ editor: changed }) => {
      const { from, to, $from } = changed.state.selection;
      selectionRef.current?.({
        from,
        to,
        text: changed.state.doc.textBetween(from, to, '\n'),
        placementBlock: $from.index(0) + 1,
      });
    },
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

  useEffect(() => {
    const publish = (): void =>
      navigationRef.current?.(
        documentNavigation(editor.state.doc, editor.state.selection.from),
      );
    publish();
    editor.on('transaction', publish);
    const onScroll = (): void => {
      const navigation = documentNavigation(
        editor.state.doc,
        editor.state.selection.from,
      );
      const current = navigation.headings
        .filter((heading) => {
          const node = editor.view.nodeDOM(heading.position);
          return node instanceof HTMLElement && node.getBoundingClientRect().top <= 140;
        })
        .at(-1);
      navigationRef.current?.({
        ...navigation,
        activePosition: current?.position ?? null,
      });
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      editor.off('transaction', publish);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [editor]);

  useEffect(() => {
    if (navigationTarget === null || navigationTarget === undefined) return;
    const position = navigationTarget.position;
    editor.commands.setTextSelection(position + 1);
    const node = editor.view.nodeDOM(position);
    if (node instanceof HTMLElement) node.scrollIntoView?.({ block: 'start' });
    editor.commands.focus(undefined, { scrollIntoView: false });
  }, [editor, navigationTarget]);

  return (
    <div
      className={styles.editor}
      onClick={(event) => {
        const target = event.target;
        const anchor =
          target instanceof Element
            ? target.closest<HTMLAnchorElement>('a[data-research-citation]')
            : null;
        if (anchor !== null && onOpenCitation !== undefined) {
          event.preventDefault();
          onOpenCitation(anchor.getAttribute('href') ?? '');
        }
      }}
    >
      {editable ? (
        toolbarHost === undefined ? (
          <DocumentToolbar editor={editor} />
        ) : (
          createPortal(<DocumentToolbar editor={editor} />, toolbarHost)
        )
      ) : null}
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
      blockquote: current.isActive('blockquote'),
      inTable: current.isActive('table'),
      citation: current.isActive('researchCitation'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  return (
    <div role="toolbar" aria-label="Formatting" className={styles.toolbar}>
      <button
        type="button"
        aria-label="Undo"
        title="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Icon name="redo" />
      </button>
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
        aria-label="Insert table"
        title="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Icon name="table" />
      </button>
      <ToggleButton
        label="Quote"
        pressed={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      {state.inTable ? (
        <>
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Delete table
          </button>
        </>
      ) : null}
      {state.citation ? (
        <label>
          Citation display
          <select
            value={
              (
                editor.getAttributes('researchCitation')['citation'] as {
                  displayStyle?: string;
                }
              ).displayStyle ?? 'SOURCE'
            }
            onChange={(event) => {
              editor
                .chain()
                .focus()
                .updateAttributes('researchCitation', {
                  citation: {
                    ...editor.getAttributes('researchCitation')['citation'],
                    displayStyle: event.target.value,
                  },
                })
                .run();
            }}
          >
            <option value="NUMERIC">Number</option>
            <option value="SOURCE">Source and location</option>
          </select>
        </label>
      ) : null}
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
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon
        name={
          (
            {
              Bold: 'bold',
              Italic: 'italic',
              'Heading 1': 'heading',
              'Heading 2': 'heading',
              'Bullet list': 'list',
              'Numbered list': 'list',
              Quote: 'quote',
            } as Record<string, IconName>
          )[label]!
        }
      />
      {label === 'Heading 1' || label === 'Heading 2' ? (
        <span>{label.slice(-1)}</span>
      ) : label === 'Numbered list' ? (
        <span>1.</span>
      ) : null}
    </button>
  );
}
