import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import type { SelectionBookmark, Transaction } from '@tiptap/pm/state';
import type { RealtimeDocument } from '../collaboration/useRealtimeDocument';
import type { UseDocumentAutosave } from '../autosave/useDocumentAutosave';
import {
  captureCanvasTarget,
  canvasSelectionKey,
  type CanvasCapture,
  type CanvasContext,
} from '../provenance/canvasTarget';
import { ApiError, apiClient, describeError } from '../../../shared/api';
import { AnchoredPopover } from '../../../shared/components/overlays/Popover';
import {
  CanvasAiChat,
  type CanvasProposalReference,
} from '../../ai/components/CanvasAiChat';
import chatStyles from '../../ai/components/CanvasAiChat.module.css';
import { Button } from '../../../shared/components/Button';

/** Saved context capture gates the shared cursor-anchored conversation controller. */
export function CanvasContextPreview({
  editor,
  bookmark,
  workspaceId,
  documentId,
  documentTitle,
  proposal,
  autosave,
  realtime,
  onClose,
}: {
  readonly editor: Editor;
  readonly bookmark: SelectionBookmark;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly documentTitle?: string;
  readonly proposal?: CanvasProposalReference;
  readonly autosave: UseDocumentAutosave;
  readonly realtime?: RealtimeDocument;
  readonly onClose: () => void;
}): ReactElement {
  const target = useRef(bookmark);
  const [original, setOriginal] = useState(() =>
    canvasSelectionKey(editor, bookmark.resolve(editor.state.doc)),
  );
  const [attempt, setAttempt] = useState(0);
  const payload = useRef<CanvasCapture | null>(null);
  const [context, setContext] = useState<CanvasContext>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const claimed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const saved =
    autosave.status === 'saved' &&
    !autosave.blocked &&
    (!realtime ||
      (realtime.connected &&
        !realtime.provider?.hasUnsyncedChanges &&
        realtime.sequence !== undefined));
  useEffect(() => {
    const map = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged)
        target.current = target.current.map(transaction.mapping);
    };
    editor.on('transaction', map);
    return () => {
      editor.off('transaction', map);
    };
  }, [editor]);
  useEffect(() => {
    if (!saved || claimed.current) return;
    claimed.current = true;

    const capture = async (): Promise<void> => {
      setBusy(true);
      setError(undefined);
      try {
        const selection = target.current.resolve(editor.state.doc);
        if (canvasSelectionKey(editor, selection) !== original)
          throw new Error(
            'The selected content changed. Close this window and select it again.',
          );
        payload.current ??= await captureCanvasTarget(
          editor,
          target.current.resolve(editor.state.doc),
          autosave.revision,
          realtime
            ? { doc: realtime.doc, epoch: realtime.epoch!, sequence: realtime.sequence! }
            : undefined,
        );
        const stored = await apiClient.post<CanvasContext>(
          `/api/workspaces/${workspaceId}/documents/${documentId}/ai/contexts`,
          { body: payload.current },
        );
        if (mounted.current) setContext(stored);
      } catch (failure) {
        if (failure instanceof ApiError && failure.problem.reason === 'NOT_SYNCHRONIZED')
          payload.current = null;
        if (mounted.current)
          setError(
            failure instanceof Error && !('problem' in failure)
              ? failure.message
              : describeError(failure),
          );
      } finally {
        if (mounted.current) setBusy(false);
      }
    };
    void capture();
  }, [
    saved,
    editor,
    original,
    autosave.revision,
    workspaceId,
    documentId,
    realtime,
    attempt,
  ]);
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const selection = target.current.resolve(editor.state.doc);
        const coords = editor.view.coordsAtPos(selection.from);
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      },
    }),
    [editor],
  );
  return (
    <AnchoredPopover
      anchor={editor.view.dom}
      title="Ask AI — document context"
      virtualAnchor={virtualAnchor}
      className={chatStyles.surface}
      onClose={onClose}
    >
      {!saved && !context ? (
        <p role="status">Waiting for your document to save and synchronize…</p>
      ) : null}
      {busy ? <p role="status">Preparing the selected context…</p> : null}
      {error ? (
        <>
          <p role="alert">{error}</p>
          <Button
            variant="secondary"
            onClick={() => {
              claimed.current = false;
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </>
      ) : null}
      {context ? (
        <div data-canvas-context-id={context.contextId}>
          <p role="status">Context ready</p>
          <p>
            {context.snapshot.target.kind === 'CARET'
              ? 'At the caret'
              : context.snapshot.target.kind === 'ANALYSIS'
                ? 'Selected analysis result'
                : 'Selected text'}
          </p>
          <blockquote>
            {context.snapshot.text ||
              `${context.snapshot.before} | ${context.snapshot.after}`}
          </blockquote>
        </div>
      ) : null}
      <CanvasAiChat
        workspaceId={workspaceId}
        documentTitle={documentTitle}
        proposal={proposal}
        context={context}
        canEdit={editor.isEditable}
        onClose={onClose}
        onChangeContext={() => {
          target.current = editor.state.selection.getBookmark();
          setOriginal(canvasSelectionKey(editor, editor.state.selection));
          payload.current = null;
          claimed.current = false;
          setContext(undefined);
          setAttempt((value) => value + 1);
        }}
      />
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </AnchoredPopover>
  );
}
