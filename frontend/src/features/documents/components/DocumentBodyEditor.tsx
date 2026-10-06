import { TrackBlockIdentity } from '../provenance/blockIdentity';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  EditorContent,
  useEditor,
  useEditorState,
  ReactNodeViewRenderer,
  type Editor,
} from '@tiptap/react';
import { createPortal } from 'react-dom';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import {
  renderCaret,
  renderSelection,
  type Collaborator,
} from '../collaboration/presence';
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import { EMPTY_TEXT_ORIGIN, prepareEmptyText } from '../collaboration/emptyText';
import type * as Y from 'yjs';

import {
  documentExtensions,
  savedDocumentOf,
  type ProseMirrorDocument,
} from '../api/documentContent';
import { documentNavigation, type DocumentNavigation } from '../api/documentNavigation';
import { Icon, type IconName } from '../../../shared/components/icons';
import styles from './DocumentPaper.module.css';
import type { EditorCitation } from '../api/researchCitation';
import { CitationPopover, citationVariant } from '../../ai/components/Citations';
import type { SelectionAction } from '../../ai/api/authoringActions';
import { SelectionToolbar } from './SelectionToolbar';
import { blockBoundary, draftDecoration } from '../api/draftDecoration';
import { DocumentAnalysisBlock } from './DocumentAnalysisBlock';
import { attachCommentAnchor, type CommentAnchor } from '../comments/commentAnchor';

export interface AuthoringSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly placementBlock: number;
}

interface DocumentBodyEditorProps {
  readonly onEditorReady?: (editor: Editor | null) => void;
  readonly onComment?: (anchor: CommentAnchor) => void;
  readonly collaborationProvider?: HocuspocusProvider | null;
  readonly collaborationUser?: Collaborator;
  readonly collaborationDocument?: Y.Doc;
  readonly workspaceId?: string;
  readonly selectionActionsEnabled?: boolean;
  readonly onSelectionAction?: (
    action: SelectionAction,
    selection: AuthoringSelection,
  ) => void;
  readonly draftHost?: HTMLElement;
  readonly draftPlacement?: number | null;
  readonly reviewSelectionEnd?: number | null;
  readonly focusBlock?: number;
  readonly toolbarHost?: HTMLElement;
  readonly sourceTypes?: ReadonlyMap<string, string>;
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
 * With a collaborationDocument, Yjs owns the live body and undo history. The server initializes it.
 */
export function DocumentBodyEditor({
  onEditorReady,
  onComment,
  workspaceId,
  collaborationDocument,
  collaborationProvider,
  collaborationUser,
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
  sourceTypes,
  selectionActionsEnabled = false,
  onSelectionAction,
  draftHost,
  draftPlacement,
  reviewSelectionEnd,
  focusBlock,
}: DocumentBodyEditorProps): ReactElement {
  const [citationPreview, setCitationPreview] = useState<{
    citation: EditorCitation;
    number: string;
    anchor: HTMLAnchorElement;
  } | null>(null);
  const openCitation = (anchor: HTMLAnchorElement): void => {
    const metadata = anchor.dataset['citation'];
    if (metadata === undefined) return;
    setCitationPreview({
      citation: JSON.parse(metadata) as EditorCitation,
      number: anchor.dataset['citationNumber'] ?? '?',
      anchor,
    });
  };
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
    extensions: [...documentExtensions, TrackBlockIdentity]
      .map((extension) =>
        extension.name === 'analysisResult'
          ? extension.extend({
              addOptions: () => ({ workspaceId }),
              addNodeView: () => ReactNodeViewRenderer(DocumentAnalysisBlock),
            })
          : extension.name === 'starterKit' && collaborationDocument !== undefined
            ? extension.configure({ undoRedo: false })
            : extension,
      )
      .concat(
        collaborationDocument === undefined
          ? []
          : [
              Collaboration.configure({
                document: collaborationDocument,
                yUndoOptions: { trackedOrigins: [EMPTY_TEXT_ORIGIN] },
              }),
            ],
      )
      .concat(
        collaborationProvider && collaborationUser
          ? [
              CollaborationCaret.extend({
                addOptions() {
                  return { ...this.parent!(), user: {} };
                },
              }).configure({
                provider: collaborationProvider,
                user: collaborationUser,
                render: (user) => renderCaret(user as Collaborator),
                selectionRender: (user) => renderSelection(user as Collaborator),
              }),
            ]
          : [],
      ),
    ...(collaborationDocument === undefined ? { content: initialContent } : {}),
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
    onUpdate: ({ editor: changed, transaction }) => {
      if (collaborationDocument && !isChangeOrigin(transaction))
        prepareEmptyText(collaborationDocument, changed.schema);
      onChangeRef.current(savedDocumentOf(changed));
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // useEditor keeps an existing editor's editable flag when options change, so it is applied here. Without
  // emitting an update: becoming read-only is not an edit.
  useEffect(() => {
    if (editor.isEditable !== editable) {
      editor.setEditable(editable, false);
      // Notify editor-state subscribers without changing content or triggering a save.
      editor.view.dispatch(editor.state.tr.setMeta('editableChanged', true));
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

  useEffect(() => {
    if (focusBlock === undefined) return;
    editor.commands.setTextSelection(blockBoundary(editor.state.doc, focusBlock) + 1);
    editor.commands.focus(undefined, { scrollIntoView: true });
  }, [editor, focusBlock]);

  useEffect(() => {
    if (
      draftHost === undefined ||
      draftPlacement === null ||
      draftPlacement === undefined
    )
      return;
    const plugin = draftDecoration(
      draftHost,
      draftPlacement,
      reviewSelectionEnd ?? undefined,
    );
    editor.registerPlugin(plugin);
    return () => {
      editor.unregisterPlugin(plugin.spec.key!);
    };
  }, [editor, draftHost, draftPlacement, reviewSelectionEnd]);

  useEffect(() => {
    const styleCitations = (): void => {
      editor.view.dom
        .querySelectorAll<HTMLAnchorElement>('a[data-citation]')
        .forEach((anchor) => {
          const citation = JSON.parse(anchor.dataset['citation']!) as EditorCitation;
          anchor.dataset['citationVariant'] = citationVariant(
            sourceTypes?.get(citation.sourceId),
          );
        });
    };
    styleCitations();
    editor.on('transaction', styleCitations);
    return () => {
      editor.off('transaction', styleCitations);
    };
  }, [editor, sourceTypes]);

  return (
    <div
      className={styles.editor}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        const target = event.target;
        const anchor =
          target instanceof Element
            ? target.closest<HTMLAnchorElement>('a[data-research-citation]')
            : null;
        if (anchor !== null) {
          event.preventDefault();
          openCitation(anchor);
        }
      }}
      onClick={(event) => {
        const target = event.target;
        const anchor =
          target instanceof Element
            ? target.closest<HTMLAnchorElement>('a[data-research-citation]')
            : null;
        if (anchor !== null) {
          event.preventDefault();
          openCitation(anchor);
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
      {editable &&
      ((selectionActionsEnabled && onSelectionAction !== undefined) ||
        onComment !== undefined) ? (
        <SelectionToolbar
          editor={editor}
          onAction={selectionActionsEnabled ? onSelectionAction : undefined}
          onComment={
            onComment
              ? () => {
                  const anchor = attachCommentAnchor(editor);
                  if (anchor) onComment(anchor);
                }
              : undefined
          }
        />
      ) : null}
      {citationPreview === null ? null : (
        <CitationPopover
          {...citationPreview}
          onClose={() => setCitationPreview(null)}
          onNavigate={onOpenCitation}
        />
      )}
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
