import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useMemo, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Transaction, SelectionBookmark } from '@tiptap/pm/state';
import { VirtualMenu } from '../../../shared/components/overlays/VirtualMenu';
import type {
  VirtualAnchor,
  MenuItem,
} from '../../../shared/components/overlays/Popover';

export function CanvasContextMenu({
  editor,
  anchor,
  bookmark,
  onClose,
  onAskAi,
  onNotice,
}: {
  readonly editor: Editor;
  readonly anchor: VirtualAnchor;
  readonly bookmark: SelectionBookmark;
  readonly onClose: () => void;
  readonly onAskAi?: (bookmark: SelectionBookmark) => void;
  readonly onNotice: (message: string) => void;
}): ReactElement {
  useUiLocale();
  const target = useMemo(() => new Map([['bookmark', bookmark]]), [bookmark]);
  useEffect(() => {
    const map = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction?.docChanged)
        target.set('bookmark', target.get('bookmark')!.map(transaction.mapping));
    };
    editor.on('transaction', map);
    return () => {
      editor.off('transaction', map);
    };
  }, [editor, target]);
  const restore = (): void => {
    editor.view.dispatch(
      editor.state.tr.setSelection(target.get('bookmark')!.resolve(editor.state.doc)),
    );
    editor.commands.focus(undefined, { scrollIntoView: false });
  };
  const selected = !editor.state.selection.empty;
  const follow = (): (() => void) => {
    let followed = target.get('bookmark')!;
    const map = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged) {
        followed = followed.map(transaction.mapping);
        target.set('bookmark', followed);
      }
    };
    editor.on('transaction', map);
    return () => {
      editor.off('transaction', map);
    };
  };
  const copy = async (cut: boolean): Promise<void> => {
    restore();
    const stop = follow();
    const slice = editor.state.selection.content();
    const text = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      '\n',
      '\uFFFC',
    );
    const html = document.createElement('div');
    html.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined')
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html.innerHTML], { type: 'text/html' }),
          }),
        ]);
      else await navigator.clipboard.writeText(text);
      if (cut) {
        restore();
        if (!editor.isEditable || !editor.state.selection.content().eq(slice))
          throw new Error('Changed target');
        editor.commands.deleteSelection();
      }
    } catch {
      onNotice(cut ? uiText('editor.cutError') : uiText('editor.copyError'));
    } finally {
      stop();
    }
  };
  const paste = async (): Promise<void> => {
    restore();
    const stop = follow();
    const original = editor.state.selection.content();
    try {
      let html = '',
        text = '';
      if (navigator.clipboard.read) {
        const entries = await navigator.clipboard.read();
        const rich = entries.find((entry) => entry.types.includes('text/html'));
        const plain = entries.find((entry) => entry.types.includes('text/plain'));
        if (rich) html = await (await rich.getType('text/html')).text();
        if (plain) text = await (await plain.getType('text/plain')).text();
      } else text = await navigator.clipboard.readText();
      restore();
      if (!editor.isEditable || !editor.state.selection.content().eq(original))
        throw new Error('Changed target');
      // Reuse native schema parsing and transformPasted: retain citations, refresh block IDs,
      // and apply the existing imported-content provenance instead of bypassing paste plugins.
      if (html) editor.view.pasteHTML(html);
      else if (text) editor.view.pasteText(text);
    } catch {
      onNotice(uiText('ui.CanvasContextMenu.message012'));
    } finally {
      stop();
    }
  };
  const run =
    (command: () => void): (() => void) =>
    () => {
      if (!editor.isEditable) return;
      restore();
      command();
    };
  const items: MenuItem[] = [];
  if (editor.isEditable)
    items.push(
      {
        id: 'undo',
        get label() {
          return uiText('ui.CanvasContextMenu.message001');
        },
        disabled: !editor.can().undo(),
        onSelect: run(() => {
          editor.commands.undo();
        }),
      },
      {
        id: 'redo',
        get label() {
          return uiText('ui.CanvasContextMenu.message002');
        },
        disabled: !editor.can().redo(),
        onSelect: run(() => {
          editor.commands.redo();
        }),
      },
      {
        id: 'cut',
        get label() {
          return uiText('ui.CanvasContextMenu.message003');
        },
        separatorBefore: true,
        disabled: !selected,
        onSelect: () => {
          void copy(true);
        },
      },
    );
  items.push({
    id: 'copy',
    get label() {
      return uiText('ui.CanvasContextMenu.message004');
    },
    disabled: !selected,
    onSelect: () => {
      void copy(false);
    },
  });
  if (editor.isEditable)
    items.push(
      {
        id: 'paste',
        get label() {
          return uiText('ui.CanvasContextMenu.message005');
        },
        onSelect: () => {
          void paste();
        },
      },
      {
        id: 'delete',
        get label() {
          return uiText('ui.CanvasContextMenu.message006');
        },
        disabled: !selected,
        onSelect: run(() => {
          editor.commands.deleteSelection();
        }),
      },
      {
        id: 'bold',
        get label() {
          return uiText('ui.CanvasContextMenu.message007');
        },
        separatorBefore: true,
        onSelect: run(() => {
          editor.commands.toggleBold();
        }),
      },
      {
        id: 'italic',
        get label() {
          return uiText('ui.CanvasContextMenu.message008');
        },
        onSelect: run(() => {
          editor.commands.toggleItalic();
        }),
      },
      {
        id: 'heading',
        get label() {
          return uiText('ui.CanvasContextMenu.message009');
        },
        onSelect: run(() => {
          editor.commands.toggleHeading({ level: 2 });
        }),
      },
      {
        id: 'list',
        get label() {
          return uiText('ui.CanvasContextMenu.message010');
        },
        onSelect: run(() => {
          editor.commands.toggleBulletList();
        }),
      },
    );
  items.push({
    id: 'ask',
    get label() {
      return uiText('ui.ResearchPanel.message007');
    },
    separatorBefore: true,
    disabled: !onAskAi,
    onSelect: () => {
      restore();
      onAskAi?.(target.get('bookmark')!);
    },
  });
  return (
    <VirtualMenu
      anchor={anchor}
      returnTo={editor.view.dom}
      items={items}
      label={uiText('ui.CanvasContextMenu.message011')}
      onClose={onClose}
    />
  );
}
