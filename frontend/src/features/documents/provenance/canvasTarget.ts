import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
import { createMappablePosition } from '@tiptap/extension-collaboration';
import * as Y from 'yjs';

export interface CanvasEndpoint {
  blockId: string | null;
  path: number[];
  offset: number;
}
export interface CanvasTarget {
  kind: 'CARET' | 'TEXT' | 'ANALYSIS' | 'SOURCE';
  start: CanvasEndpoint;
  end: CanvasEndpoint;
  hash: string;
}
export interface CanvasCapture {
  schemaVersion: '1.0';
  clientRequestId: string;
  revision: number;
  epoch: number | null;
  sequence: number | null;
  stateVector: string | null;
  relative: { start: string; end: string } | null;
  target: CanvasTarget;
}
export interface CanvasContext {
  schemaVersion: '1.0';
  contextId: string;
  workspaceId: string;
  documentId: string;
  revision: number;
  epoch: number | null;
  sequence: number | null;
  createdAt: string;
  snapshot: {
    target: CanvasTarget;
    text: string;
    before: string;
    after: string;
    sources: readonly {
      sourceId: string;
      sourceVersionId: string | null;
      chunkId: string | null;
      processingVersion: string | null;
    }[];
    analyses: readonly { analysisId: string; executionId: string; outputId: string }[];
  };
}
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export async function canvasHash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join(
    '',
  );
}
export function canvasEndpoint(
  doc: Node,
  position: number,
  analysis = false,
): CanvasEndpoint {
  let result: CanvasEndpoint | undefined;
  const walk = (node: Node, start: number, path: number[]): void => {
    if (result) return;
    if (
      analysis
        ? node.type.name === 'analysisResult' && position >= start && position < start + 1
        : node.isTextblock &&
          position >= start + 1 &&
          position <= start + 1 + node.content.size
    )
      result = {
        blockId: (node.attrs['blockId'] as string | null) ?? null,
        path,
        offset: position - start - (analysis ? 0 : 1),
      };
    else
      node.forEach((child, offset, index) =>
        walk(child, start + 1 + offset, [...path, index]),
      );
  };
  walk(doc, -1, []);
  if (!result) throw new Error('Choose text, a caret, a citation or an analysis result.');
  return result;
}
function edge(text: string, count: number, tail = false): string {
  let position = tail ? Math.max(0, text.length - count) : Math.min(count, text.length);
  if (
    position > 0 &&
    position < text.length &&
    /[\uD800-\uDBFF]/.test(text[position - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[position]!)
  )
    position += tail ? 1 : -1;
  return tail ? text.slice(position) : text.slice(0, position);
}
export function canvasFingerprint(editor: Editor, selection: Selection): string {
  const { from, to } = selection;
  let fingerprint: string;
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === 'analysisResult'
  ) {
    const ref = (selection as NodeSelection).node.attrs['reference'] as {
      analysisId: string;
      executionId: string;
      outputId: string;
    };
    fingerprint = `${ref.analysisId}:${ref.executionId}:${ref.outputId}`;
  } else if (selection.empty) {
    const parent = selection.$from.parent;
    fingerprint =
      edge(parent.textBetween(0, selection.$from.parentOffset, '', '\uFFFC'), 32, true) +
      '\0' +
      edge(
        parent.textBetween(
          selection.$from.parentOffset,
          parent.content.size,
          '',
          '\uFFFC',
        ),
        32,
      );
  } else fingerprint = editor.state.doc.textBetween(from, to, '\n', '\uFFFC');
  return fingerprint;
}

/** While waiting for a save, a mapped bookmark must still refer to the same logical blocks. */
export function canvasSelectionKey(editor: Editor, selection: Selection): string {
  const analysis =
    selection instanceof NodeSelection && selection.node.type.name === 'analysisResult';
  const start = canvasEndpoint(editor.state.doc, selection.from, analysis);
  const end = analysis ? start : canvasEndpoint(editor.state.doc, selection.to);
  return JSON.stringify([
    canvasFingerprint(editor, selection),
    start.blockId ?? start.path,
    end.blockId ?? end.path,
  ]);
}

/** No await occurs until the immutable JSON/relative-position snapshot has been assembled. */
export async function captureCanvasTarget(
  editor: Editor,
  selection: Selection,
  revision: number,
  realtime?: { doc: Y.Doc; epoch: number; sequence: number },
): Promise<CanvasCapture> {
  const { from, to } = selection;
  const analysis =
    selection instanceof NodeSelection && selection.node.type.name === 'analysisResult';
  const source =
    selection instanceof NodeSelection && selection.node.type.name === 'researchCitation';
  const kind: CanvasTarget['kind'] = analysis
    ? 'ANALYSIS'
    : source
      ? 'SOURCE'
      : selection.empty
        ? 'CARET'
        : 'TEXT';
  const start = canvasEndpoint(editor.state.doc, from, analysis),
    end = analysis ? { ...start, offset: 1 } : canvasEndpoint(editor.state.doc, to);
  const fingerprint = canvasFingerprint(editor, selection);
  if (fingerprint.length > 4000) throw new Error('Select at most 4000 characters.');
  let relative: CanvasCapture['relative'] = null;
  if (realtime) {
    const encode = (pos: number): string => {
      const position = createMappablePosition(pos, editor.state)
        .yRelativePosition as Y.RelativePosition | null;
      if (!position) throw new Error('Wait for the document to synchronize.');
      return base64(Y.encodeRelativePosition(position));
    };
    relative = { start: encode(from), end: encode(to) };
  }
  const result = {
    schemaVersion: '1.0' as const,
    clientRequestId: crypto.randomUUID(),
    revision,
    epoch: realtime?.epoch ?? null,
    sequence: realtime?.sequence ?? null,
    stateVector: realtime ? base64(Y.encodeStateVector(realtime.doc)) : null,
    relative,
    target: { kind, start, end, hash: '' },
  };
  result.target.hash = await canvasHash(fingerprint);
  return result;
}
