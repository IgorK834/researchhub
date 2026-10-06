/** @jest-environment jsdom */
import { useState, type ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentComments } from './DocumentComments';
import { commentApi, type DocumentComment } from './commentApi';
import { attachCommentAnchor } from './commentAnchor';
import { documentExtensions } from '../api/documentContent';
import { ApiError, queryKeys } from '../../../shared/api';

jest.mock('./commentApi', () => ({
  commentApi: {
    list: jest.fn(),
    create: jest.fn(),
    reply: jest.fn(),
    status: jest.fn(),
    thread: jest.fn(),
  },
}));
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const date = '2026-10-06T10:00:00Z';
const base: DocumentComment = {
  id,
  workspaceId: 'w',
  documentId: 'd',
  authorId: 'u',
  authorName: 'Ada Lovelace',
  body: 'Cite the standard?',
  status: 'OPEN',
  anchor: { strategy: 'TEXT_MARK_V1', id, quote: 'Evidence' },
  orphaned: false,
  createdAt: date,
  updatedAt: date,
  resolvedBy: null,
  resolvedAt: null,
  replies: [],
  aiSuggestions: [],
};
let client: QueryClient, editor: Editor, rows: DocumentComment[];
const opened = jest.fn(),
  canceled = jest.fn();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
type Props = Partial<Parameters<typeof DocumentComments>[0]>;
function panel(props: Props = {}) {
  return (
    <DocumentComments
      workspaceId="w"
      documentId="d"
      editor={editor}
      canComment
      saved
      pendingAnchor={null}
      onCancel={canceled}
      onOpen={opened}
      {...props}
    />
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  rows = [{ ...base }];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: documentExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Evidence',
              marks: [{ type: 'commentAnchor', attrs: { ids: [id] } }],
            },
          ],
        },
      ],
    },
  });
  jest.mocked(commentApi.list).mockImplementation(async () => rows);
  jest.mocked(commentApi.create).mockImplementation(async (_w, _d, anchor, body) => {
    const value = { ...base, id: anchor.id, anchor, body };
    rows = [...rows.filter((item) => item.id !== value.id), value];
    return value;
  });
  jest
    .mocked(commentApi.reply)
    .mockImplementation(async (_w, _d, commentId, replyId, body) => {
      const value = {
        ...rows.find((row) => row.id === commentId)!,
        replies: [
          {
            id: replyId,
            authorId: 'v',
            authorName: 'Grace Hopper',
            body,
            createdAt: date,
          },
        ],
      };
      rows = [value];
      return value;
    });
  jest.mocked(commentApi.status).mockImplementation(async (_w, _d, commentId, status) => {
    const value = {
      ...rows.find((row) => row.id === commentId)!,
      status,
      resolvedAt: status === 'RESOLVED' ? date : null,
      resolvedBy: status === 'RESOLVED' ? 'u' : null,
    };
    rows = [value];
    return value;
  });
  jest.mocked(commentApi.thread).mockResolvedValue({
    comment: base,
    events: ['CREATED', 'REPLIED', 'RESOLVED', 'REOPENED'].map((action, index) => ({
      id: String(index),
      actorId: 'u',
      actorName: 'Ada',
      action: action as 'CREATED',
      status: 'OPEN',
      previousStatus: null,
      createdAt: date,
    })),
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  const element = editor.options.element as HTMLElement;
  editor.destroy();
  element.remove();
});
const loaded = (): Promise<HTMLElement> =>
  screen.findByRole('article', { name: 'Comment by Ada Lovelace' });
const unavailable = (): ApiError =>
  new ApiError({
    type: 'about:blank',
    title: 'Forbidden',
    detail: 'Access changed',
    status: 403,
    code: 'FORBIDDEN',
    rawCode: 'FORBIDDEN',
  });

it('renders quotes and contributions, navigates to live text, and opens the side panel from an anchor', async () => {
  render(panel(), { wrapper });
  await loaded();
  const span = editor.view.dom.querySelector('span')!;
  const scroll = jest.fn();
  span.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole('button', { name: 'Go to commented text: Evidence' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(9);
  fireEvent.click(span);
  expect(opened).toHaveBeenCalled();
  expect(span.getAttribute('data-comment-status')).toBe('open');
  expect(span.getAttribute('data-comment-active')).toBe('true');
  fireEvent.click(editor.view.dom); // Plain text outside a marked span is harmless.
});

it('creates a comment only after its anchor is saved and preserves the editor content', async () => {
  rows = [];
  editor.commands.setTextSelection({ from: 1, to: 9 });
  const anchor = attachCommentAnchor(editor)!;
  const initial = editor.getJSON();
  const view = render(panel({ pendingAnchor: anchor, saved: false }), { wrapper });
  await screen.findByText('No open comments yet.');
  expect(document.activeElement).toBe(screen.getByLabelText('Write a comment'));
  fireEvent.change(screen.getByLabelText('Write a comment'), {
    target: { value: 'Please cite this.' },
  });
  expect(
    (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText('Waiting for the selected text to be saved…')).toBeTruthy();
  view.rerender(panel({ pendingAnchor: anchor }));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() =>
    expect(commentApi.create).toHaveBeenCalledWith('w', 'd', anchor, 'Please cite this.'),
  );
  await waitFor(() => expect(canceled).toHaveBeenCalled());
  expect(editor.getJSON()).toEqual(initial);
  expect(screen.getByText('Please cite this.')).toBeTruthy();
});

it('retains a failed draft and retries with the same comment id, then clears it on cancel', async () => {
  jest.mocked(commentApi.create).mockRejectedValueOnce(new Error('Offline'));
  render(panel({ pendingAnchor: base.anchor }), { wrapper });
  await loaded();
  fireEvent.change(screen.getByLabelText('Write a comment'), {
    target: { value: 'Keep my draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Your draft is kept here',
  );
  expect((screen.getByLabelText('Write a comment') as HTMLTextAreaElement).value).toBe(
    'Keep my draft',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(canceled).toHaveBeenCalled());
  expect(jest.mocked(commentApi.create).mock.calls[0]).toEqual(
    jest.mocked(commentApi.create).mock.calls[1],
  );
  fireEvent.change(screen.getByLabelText('Write a comment'), {
    target: { value: 'New draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((screen.getByLabelText('Write a comment') as HTMLTextAreaElement).value).toBe(
    '',
  );
});

it('replies with a durable retry id, resolves, reopens and displays resolved contributions', async () => {
  render(panel(), { wrapper });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.change(screen.getByLabelText('Reply to Ada Lovelace'), {
    target: { value: 'I will add it.' },
  });
  jest.mocked(commentApi.reply).mockRejectedValueOnce(new Error('Lost response'));
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByText('I will add it.');
  expect(jest.mocked(commentApi.reply).mock.calls[0]).toEqual(
    jest.mocked(commentApi.reply).mock.calls[1],
  );
  expect(screen.getByText('Grace Hopper')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  await screen.findByText('No open comments yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }));
  await loaded();
  expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  await screen.findByText('No resolved threads.');
  fireEvent.click(screen.getByRole('button', { name: 'Open (1)' }));
  await loaded();
  expect(commentApi.status).toHaveBeenCalledWith('w', 'd', id, 'OPEN');
});

it('makes a new reply key for a changed draft and can cancel a reply', async () => {
  jest.mocked(commentApi.reply).mockRejectedValue(new Error('Offline'));
  render(panel(), { wrapper });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.change(screen.getByLabelText('Reply to Ada Lovelace'), {
    target: { value: 'First' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Reply to Ada Lovelace'), {
    target: { value: 'Second' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByRole('alert');
  expect(jest.mocked(commentApi.reply).mock.calls[0]![3]).not.toBe(
    jest.mocked(commentApi.reply).mock.calls[1]![3],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
  expect(screen.queryByLabelText('Reply to Ada Lovelace')).toBeNull();
});

it('gracefully orphans deleted text while retaining the thread, then recovers it on undo', async () => {
  const view = render(panel({ pendingAnchor: base.anchor }), { wrapper });
  await loaded();
  act(() => {
    editor.commands.selectAll();
    editor.commands.deleteSelection();
  });
  expect(screen.getByText(/Original passage is no longer available/)).toBeTruthy();
  expect(screen.getByText(/Selected text was removed/)).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Go to commented text: Evidence',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  act(() => editor.commands.undo());
  expect(screen.queryByText(/Original passage is no longer available/)).toBeNull();
  view.rerender(panel({ editor: null }));
});

it('offers viewers read access and activity while hiding every mutating action', async () => {
  render(panel({ canComment: false }), { wrapper });
  await loaded();
  expect(screen.getByText(/Read-only comments/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  await screen.findByText(/reopened the thread/);
  const activity = screen.getByLabelText('Comment activity');
  expect(within(activity).getAllByRole('listitem')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(screen.queryByLabelText('Comment activity')).toBeNull();
});

it('handles loading and failed activity requests', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(commentApi.thread).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(panel(), { wrapper });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(await screen.findByText('Loading activity…')).toBeTruthy();
  await act(async () => reject(new Error('Activity unavailable')));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load activity',
  );
});

it('handles failed list requests, refreshes, and keeps orphaned server comments readable without an editor', async () => {
  rows = [{ ...base, orphaned: true, resolvedAt: null, status: 'RESOLVED' }];
  jest.mocked(commentApi.list).mockRejectedValueOnce(new Error('Unavailable'));
  render(panel({ editor: null }), { wrapper });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh comments' }));
  await screen.findByRole('button', { name: 'Resolved (1)' });
  fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }));
  await loaded();
  expect(screen.getByText(/Original passage is no longer available/)).toBeTruthy();
});

it('responds to permission revocation on writes', async () => {
  jest.mocked(commentApi.status).mockRejectedValue(unavailable());
  render(panel(), { wrapper });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  await screen.findByRole('alert');
  expect(screen.getByText(/Read-only comments/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
});

it('updates known anchor highlighting from a remote thread and preserves its cache scope', async () => {
  rows = [{ ...base, status: 'RESOLVED', resolvedAt: date }];
  const view = render(panel(), { wrapper });
  await screen.findByRole('button', { name: 'Resolved (1)' });
  const span = editor.view.dom.querySelector('span')!;
  expect(span.getAttribute('data-comment-status')).toBe('resolved');
  fireEvent.click(span);
  await loaded();
  expect(opened).toHaveBeenCalled();
  const data = client.getQueryData<DocumentComment[]>(
    queryKeys.documentComments('w', 'd'),
  );
  expect(data?.[0]?.status).toBe('RESOLVED');
  view.rerender(panel({ pendingAnchor: base.anchor }));
  expect(span.getAttribute('data-comment-status')).toBe('pending');
});

it('keeps a pending request unavailable until the server returns and treats empty data as an empty state', async () => {
  let resolve!: (data: DocumentComment[]) => void;
  jest.mocked(commentApi.list).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(panel(), { wrapper });
  expect(screen.getByText('Loading comments…')).toBeTruthy();
  await act(async () => resolve([]));
  expect(await screen.findByText('No open comments yet.')).toBeTruthy();
});
