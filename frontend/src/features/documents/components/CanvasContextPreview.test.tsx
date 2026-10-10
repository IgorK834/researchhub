/** @jest-environment jsdom */
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../api/documentContent';
import { CanvasContextPreview } from './CanvasContextPreview';
import { apiClient } from '../../../shared/api';
import { ApiError } from '../../../shared/api/apiError';
import * as canvasTarget from '../provenance/canvasTarget';
import * as Y from 'yjs';
import type { RealtimeDocument } from '../collaboration/useRealtimeDocument';
import type { UseDocumentAutosave } from '../autosave/useDocumentAutosave';
jest.mock('../../../shared/api', () => ({
  ...jest.requireActual('../../../shared/api'),
  apiClient: { post: jest.fn() },
}));
jest.mock('../../ai/components/CanvasAiChat', () => ({ CanvasAiChat: () => null }));
let editor: Editor;
const autosave: UseDocumentAutosave = {
  status: 'saved',
  blocked: false,
  error: null,
  revision: 1,
  savedAt: 'now',
  edit: () => {},
  saveNow: () => {},
  retry: () => {},
};
beforeEach(() => {
  Object.defineProperty(crypto, 'subtle', { value: webcrypto.subtle });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  editor = new Editor({
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
    },
  });
  jest
    .spyOn(editor.view, 'coordsAtPos')
    .mockReturnValue({ left: 100, right: 100, top: 100, bottom: 120 });
  document.body.append(editor.view.dom);
  editor.commands.setTextSelection({ from: 1, to: 4 });
  (apiClient.post as jest.Mock).mockReset().mockResolvedValue({
    contextId: 'ctx',
    snapshot: { target: { kind: 'TEXT' }, text: 'abc', before: '', after: '' },
  });
});
afterEach(() => editor.destroy());
const props = () => ({
  editor,
  bookmark: editor.state.selection.getBookmark(),
  workspaceId: 'w',
  documentId: 'd',
  autosave,
  onClose: jest.fn(),
});
it('captures once and reviews only the saved context, without creating a conversation', async () => {
  const options = props();
  render(<CanvasContextPreview {...options} />);
  await screen.findByText('Context ready');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect((apiClient.post as jest.Mock).mock.calls[0][0]).toBe(
    '/api/workspaces/w/documents/d/ai/contexts',
  );
  fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
  expect(options.onClose).toHaveBeenCalled();
});
it('waits for autosave, maps unrelated insertions and retains the original target', async () => {
  const options = props();
  const view = render(
    <CanvasContextPreview {...options} autosave={{ ...autosave, status: 'saving' }} />,
  );
  expect(screen.getByText(/Waiting/)).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
  act(() => editor.commands.insertContentAt(1, 'prefix '));
  view.rerender(<CanvasContextPreview {...options} />);
  await screen.findByText('Context ready');
  expect((apiClient.post as jest.Mock).mock.calls[0][1].body.target.start.offset).toBe(7);
});
it('a changed selected target yields a conflict and cannot be recaptured silently', async () => {
  const options = props();
  const view = render(
    <CanvasContextPreview {...options} autosave={{ ...autosave, status: 'saving' }} />,
  );
  act(() => editor.commands.insertContentAt({ from: 1, to: 4 }, 'changed'));
  view.rerender(<CanvasContextPreview {...options} />);
  await screen.findByRole('alert');
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed'));
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('retries a lost HTTP response with the same request identity and handles closing during capture', async () => {
  (apiClient.post as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const view = render(<CanvasContextPreview {...props()} />);
  await screen.findByText('offline');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Context ready');
  const calls = (apiClient.post as jest.Mock).mock.calls;
  expect(calls[0][1].body.clientRequestId).toBe(calls[1][1].body.clientRequestId);
  view.unmount();
  (apiClient.post as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const other = render(<CanvasContextPreview {...props()} />);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
  other.unmount();
});
it('waits for the durable Yjs sequence and sends the room identity only after sync', async () => {
  const capture = jest
    .spyOn(canvasTarget, 'captureCanvasTarget')
    .mockResolvedValue({ schemaVersion: '1.0' } as canvasTarget.CanvasCapture);
  const doc = new Y.Doc();
  const realtime = {
    doc,
    epoch: 2,
    sequence: undefined,
    connected: false,
    provider: { hasUnsyncedChanges: true },
  } as unknown as RealtimeDocument;
  const options = props();
  const view = render(<CanvasContextPreview {...options} realtime={realtime} />);
  expect(apiClient.post).not.toHaveBeenCalled();
  view.rerender(
    <CanvasContextPreview
      {...options}
      realtime={{ ...realtime, connected: true, sequence: 9 }}
    />,
  );
  expect(apiClient.post).not.toHaveBeenCalled();
  view.rerender(
    <CanvasContextPreview
      {...options}
      realtime={{ ...realtime, connected: true, sequence: 9, provider: null }}
    />,
  );
  await screen.findByText('Context ready');
  expect(capture).toHaveBeenCalledWith(editor, expect.anything(), 1, {
    doc,
    epoch: 2,
    sequence: 9,
  });
  view.unmount();
  doc.destroy();
  capture.mockRestore();
});
it('reviews a caret with bounded surroundings and an analysis result with a clear label', async () => {
  editor.commands.setTextSelection(1);
  (apiClient.post as jest.Mock).mockResolvedValueOnce({
    contextId: 'caret',
    snapshot: { target: { kind: 'CARET' }, text: '', before: 'before', after: 'after' },
  });
  const view = render(<CanvasContextPreview {...props()} />);
  await screen.findByText('At the caret');
  expect(screen.getByText('before | after')).toBeTruthy();
  view.unmount();
  (apiClient.post as jest.Mock).mockResolvedValueOnce({
    contextId: 'analysis',
    snapshot: { target: { kind: 'ANALYSIS' }, text: 'Computed result' },
  });
  render(<CanvasContextPreview {...props()} />);
  await screen.findByText('Selected analysis result');
});
it('renders a server conflict and ignores successful or failed responses after closing', async () => {
  (apiClient.post as jest.Mock).mockRejectedValueOnce(
    new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CONFLICT',
      rawCode: 'CONFLICT',
      detail: 'Select the changed target again.',
    }),
  );
  const view = render(<CanvasContextPreview {...props()} />);
  await screen.findByText('Select the changed target again.');
  view.unmount();
  for (const fail of [false, true]) {
    let finish!: (result: unknown) => void;
    (apiClient.post as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = fail ? reject : resolve;
        }),
    );
    const other = render(<CanvasContextPreview {...props()} />);
    await waitFor(() => expect(finish).toBeDefined());
    other.unmount();
    await act(async () =>
      finish(fail ? new Error('late') : { contextId: 'late', snapshot: {} }),
    );
  }
});
it('recaptures the same mapped target after an explicit retry of a synchronization conflict', async () => {
  (apiClient.post as jest.Mock).mockRejectedValueOnce(
    new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CONFLICT',
      rawCode: 'CONFLICT',
      reason: 'NOT_SYNCHRONIZED',
      detail: 'Synchronize again.',
    }),
  );
  render(<CanvasContextPreview {...props()} />);
  await screen.findByText('Synchronize again.');
  act(() => editor.commands.insertContentAt(1, 'prefix '));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Context ready');
  const calls = (apiClient.post as jest.Mock).mock.calls;
  expect(calls[0][1].body.clientRequestId).not.toBe(calls[1][1].body.clientRequestId);
  expect(calls[1][1].body.target.start.offset).toBe(7);
});
it('does not retarget an empty caret into another block after the original block is deleted', async () => {
  editor.commands.setContent({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: crypto.randomUUID() } },
      { type: 'paragraph', attrs: { blockId: crypto.randomUUID() } },
    ],
  });
  editor.commands.setTextSelection(1);
  const options = props();
  const view = render(
    <CanvasContextPreview {...options} autosave={{ ...autosave, status: 'saving' }} />,
  );
  act(() => editor.commands.deleteRange({ from: 0, to: 2 }));
  view.rerender(<CanvasContextPreview {...options} />);
  await screen.findByRole('alert');
  expect(apiClient.post).not.toHaveBeenCalled();
});
