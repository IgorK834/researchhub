/** @jest-environment jsdom */
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Editor } from '@tiptap/core';
import { CommentEvidence } from './CommentEvidence';
import { commentApi, type DocumentComment } from './commentApi';
import { documentExtensions } from '../api/documentContent';
import type { Citation } from '../../ai/api/generationApi';

jest.mock('./commentApi', () => ({
  commentApi: { evidence: jest.fn(), acceptEvidence: jest.fn() },
}));
const anchor = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const citation: Citation = {
  chunkId: 'b'.repeat(64),
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'v',
  processingVersion: 'p',
  contentHash: 'a'.repeat(64),
  pageStart: 7,
  pageEnd: 7,
  sectionTitle: 'Theory',
  spans: [{ unitId: 'page-7', characterStart: 0, characterEnd: 8 }],
  title: 'Lecture',
};
const base: DocumentComment = {
  id: 'c',
  workspaceId: 'w',
  documentId: 'd',
  authorId: 'u',
  authorName: 'Ada',
  body: 'Verify claim',
  status: 'OPEN',
  anchor: { strategy: 'TEXT_MARK_V1', id: anchor, quote: 'Evidence' },
  orphaned: false,
  createdAt: '2026-10-06T10:00:00Z',
  updatedAt: '2026-10-06T10:00:00Z',
  resolvedBy: null,
  resolvedAt: null,
  replies: [],
  aiSuggestions: [],
};
const suggestion: DocumentComment = {
  ...base,
  aiSuggestions: [
    {
      id: 'suggestion',
      commentId: 'c',
      kind: 'AI_EVIDENCE',
      requestedBy: 'u',
      requestedByName: 'Ada',
      claim: 'Evidence',
      createdAt: base.createdAt,
      acceptedChunkIds: [],
      evidence: {
        candidates: [
          {
            citation,
            snippet: 'Extracted source text',
            category: 'supporting',
            relevance: 0.9,
            reason: 'Supports this claim.',
          },
        ],
        warnings: ['Review this result.'],
        generation: {
          requestId: 'r',
          templateId: 't',
          model: {
            provider: 'deterministic',
            name: 'fixture',
            version: '1',
            structuredOutput: true,
            streaming: false,
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimated: true },
        },
      },
    },
  ],
};
let client: QueryClient, editor: Editor;
const updated = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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
              marks: [{ type: 'commentAnchor', attrs: { ids: [anchor] } }],
            },
          ],
        },
      ],
    },
  });
  jest.mocked(commentApi.evidence).mockResolvedValue(suggestion);
  jest.mocked(commentApi.acceptEvidence).mockResolvedValue({
    ...suggestion,
    aiSuggestions: [
      { ...suggestion.aiSuggestions[0]!, acceptedChunkIds: [citation.chunkId] },
    ],
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  editor.destroy();
  document.body.innerHTML = '';
});
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
type Props = Partial<Parameters<typeof CommentEvidence>[0]>;
function panel(props: Props = {}) {
  return (
    <CommentEvidence
      workspaceId="w"
      documentId="d"
      comment={suggestion}
      editor={editor}
      writable
      available
      saved
      onUpdated={updated}
      {...props}
    />
  );
}

it('does not invoke automatically and explicitly retries with the same request id after a failure', async () => {
  render(panel({ comment: base }), { wrapper });
  expect(commentApi.evidence).not.toHaveBeenCalled();
  jest.mocked(commentApi.evidence).mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Find evidence with AI' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Find evidence with AI' }));
  await waitFor(() => expect(updated).toHaveBeenCalledWith(suggestion));
  expect(jest.mocked(commentApi.evidence).mock.calls[0]).toEqual(
    jest.mocked(commentApi.evidence).mock.calls[1],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Find evidence with AI' }));
  await waitFor(() => expect(commentApi.evidence).toHaveBeenCalledTimes(3));
  expect(jest.mocked(commentApi.evidence).mock.calls[2]?.[3]).not.toBe(
    jest.mocked(commentApi.evidence).mock.calls[0]?.[3],
  );
});
it('visually identifies AI, invoker, model, evidence category and an inspectable source link', () => {
  render(panel(), { wrapper });
  expect(screen.getByRole('region', { name: 'AI evidence suggestion' })).toBeTruthy();
  expect(screen.getByText('AI · Evidence suggestion')).toBeTruthy();
  expect(screen.getByText(/Requested by Ada/)).toBeTruthy();
  expect(screen.getByText('deterministic · fixture')).toBeTruthy();
  expect(screen.getByText('Supporting evidence')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Lecture · p. 7' }).getAttribute('href')).toBe(
    '/app/workspaces/w/sources/s?processingVersion=p&unit=page-7&page=7',
  );
  expect(screen.getByText('Supports this claim.')).toBeTruthy();
  expect(screen.getByText('Extracted source text')).toBeTruthy();
  expect(screen.getByText('Review this result.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
});
it('keeps viewers read-only and disables actions for resolved, unsaved and orphaned claims', () => {
  const view = render(panel({ writable: false }), { wrapper });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('link')).toBeTruthy();
  view.rerender(panel({ comment: { ...suggestion, status: 'RESOLVED' } }));
  expect(screen.queryByRole('button', { name: 'Find evidence with AI' })).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Insert citation' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  for (const props of [{ available: false }, { saved: false }, { editor: null }]) {
    view.rerender(panel(props));
    expect(
      (screen.getByRole('button', { name: 'Insert citation' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
});
it('waits for document save before confirming a manually inserted citation', async () => {
  let saved: (value: boolean) => void = () => {};
  function Harness() {
    const [settled, setSettled] = useState(true);
    saved = setSettled;
    return panel({ saved: settled });
  }
  editor.on('update', () => saved(false));
  render(<Harness />, { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Insert citation' }));
  expect(editor.getJSON().content?.[0]?.content?.[1]?.type).toBe('researchCitation');
  expect(commentApi.acceptEvidence).not.toHaveBeenCalled();
  expect(screen.getByText('Waiting for the inserted citation to be saved…')).toBeTruthy();
  act(() => saved(true));
  await waitFor(() =>
    expect(commentApi.acceptEvidence).toHaveBeenCalledWith(
      'w',
      'd',
      'c',
      'suggestion',
      citation.chunkId,
    ),
  );
  expect(updated).toHaveBeenCalled();
});
it('retains insertion on confirmation failure and offers an idempotent retry', async () => {
  jest
    .mocked(commentApi.acceptEvidence)
    .mockRejectedValueOnce(new Error('Network problem'));
  render(panel(), { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Insert citation' }));
  await screen.findByRole('button', { name: 'Retry confirmation' });
  expect(editor.getJSON().content?.[0]?.content?.[1]?.type).toBe('researchCitation');
  fireEvent.click(screen.getByRole('button', { name: 'Retry confirmation' }));
  await waitFor(() => expect(updated).toHaveBeenCalled());
  expect(jest.mocked(commentApi.acceptEvidence).mock.calls[0]).toEqual(
    jest.mocked(commentApi.acceptEvidence).mock.calls[1],
  );
});
it('gracefully handles a live deletion or permission loss when inserting', () => {
  render(panel(), { wrapper });
  editor.setEditable(false);
  fireEvent.click(screen.getByRole('button', { name: 'Insert citation' }));
  expect(screen.getByRole('alert').textContent).toContain('read-only');
  expect(commentApi.acceptEvidence).not.toHaveBeenCalled();
});
it('requires fresh evidence if the claim changes and can keep an edit after failed confirmation', async () => {
  jest.mocked(commentApi.acceptEvidence).mockRejectedValue(new Error('Cannot confirm'));
  render(panel(), { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Insert citation' }));
  await screen.findByRole('button', { name: 'Keep edit and dismiss' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep edit and dismiss' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(editor.getJSON().content?.[0]?.content?.[1]?.type).toBe('researchCitation');
  act(() => {
    editor.commands.insertContentAt(4, 'changed');
  });
  expect(
    screen.getByText('Highlighted text changed. Request fresh evidence before citing.'),
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Insert citation' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(commentApi.evidence).not.toHaveBeenCalled();
});
it('shows related and insufficient results without presenting insufficient material as citable', () => {
  const first = suggestion.aiSuggestions[0]!;
  render(
    panel({
      comment: {
        ...base,
        aiSuggestions: [
          {
            ...first,
            evidence: {
              ...first.evidence,
              generation: null,
              candidates: [
                {
                  ...first.evidence.candidates[0]!,
                  citation: {
                    ...citation,
                    chunkId: 'd'.repeat(64),
                    title: null,
                    pageStart: null,
                    pageEnd: null,
                  },
                  category: 'related',
                },
                { ...first.evidence.candidates[0]!, category: 'insufficient' },
              ],
            },
          },
        ],
      },
    }),
    { wrapper },
  );
  expect(screen.getByText('Related evidence')).toBeTruthy();
  expect(screen.getByText('Insufficient evidence')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Insert citation' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Open source' })).toBeTruthy();
});
it('shows the durable manual acceptance receipt and keeps generation busy state accessible', async () => {
  const first = suggestion.aiSuggestions[0]!;
  let complete!: (value: DocumentComment) => void;
  jest.mocked(commentApi.evidence).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(
    panel({
      comment: {
        ...suggestion,
        aiSuggestions: [{ ...first, acceptedChunkIds: [citation.chunkId] }],
      },
    }),
    { wrapper },
  );
  expect(screen.getByText('Citation inserted manually')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Insert citation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find evidence with AI' }));
  await screen.findByRole('status');
  expect(
    (screen.getByRole('button', { name: 'Find evidence with AI' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => complete(suggestion));
});
