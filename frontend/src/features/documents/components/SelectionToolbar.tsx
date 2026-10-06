import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState, type Editor } from '@tiptap/react';
import { SELECTION_ACTIONS, type SelectionAction } from '../../ai/api/authoringActions';
import type { AuthoringSelection } from './DocumentBodyEditor';
import styles from './SelectionToolbar.module.css';

export function SelectionToolbar({
  editor,
  onAction,
  onComment,
}: {
  readonly editor: Editor;
  readonly onAction?: (action: SelectionAction, selection: AuthoringSelection) => void;
  readonly onComment?: () => void;
}): ReactElement | null {
  const surface = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const editorElement = editor.view.dom;
    const followFocus = (event: FocusEvent): void => {
      const target = event.target as Node;
      setFocused(
        editorElement.contains(target) || Boolean(surface.current?.contains(target)),
      );
    };
    document.addEventListener('focusin', followFocus);
    return () => document.removeEventListener('focusin', followFocus);
  }, [editor]);
  const selection = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { from, to, $from } = current.state.selection;
      return {
        from,
        to,
        text: current.state.doc.textBetween(from, to, '\n'),
        placementBlock: $from.index(0) + 1,
      };
    },
  });
  const visible =
    focused &&
    selection.from !== selection.to &&
    selection.text.trim().length > 0 &&
    selection.text.length <= 2000;
  useEffect(() => {
    if (!visible) return;
    const editorElement = editor.view.dom;
    const position = (): void => {
      if (!surface.current) return;
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      const rect = surface.current.getBoundingClientRect();
      const gap = 8;
      surface.current.style.left = `${Math.max(gap, Math.min((start.left + end.right - rect.width) / 2, window.innerWidth - rect.width - gap))}px`;
      surface.current.style.top = `${Math.max(gap, start.top - rect.height - gap)}px`;
    };
    const focusActions = (event: KeyboardEvent): void => {
      if (
        (event.key === 'F10' && event.altKey) ||
        (event.key === 'Tab' && !event.shiftKey)
      ) {
        if (!editorElement.contains(event.target as Node)) return;
        event.preventDefault();
        surface.current?.querySelector('button')?.focus();
      }
    };
    position();
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    editorElement.addEventListener('keydown', focusActions);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      editorElement.removeEventListener('keydown', focusActions);
    };
  }, [editor, selection, visible]);
  if (!visible) return null;
  return createPortal(
    <div
      ref={surface}
      role="toolbar"
      aria-label={
        onComment ? 'Actions for selected text' : 'AI actions for selected text'
      }
      aria-keyshortcuts="Alt+F10"
      title="Actions for selected text (Tab or Alt+F10)"
      className={styles.toolbar}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          editor.commands.focus(undefined, { scrollIntoView: false });
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) %
                buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      {onAction
        ? SELECTION_ACTIONS.map(([action, label]) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action, selection)}
            >
              {label}
            </button>
          ))
        : null}
      {onComment ? (
        <button type="button" onClick={onComment}>
          Add comment
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
