/** @jest-environment jsdom */
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ResearchPanel, type ResearchPanelProps } from './ResearchPanel';
import * as api from '../api/conversationApi';
import { fetchCitationFragment } from '../api/citationEvidence';
import { conversationRecency, scopeLabel } from './ResearchNavigation';
import { ResearchAnswer, CitationPanel, citationLocation } from './ResearchEvidence';
import { ApiError, queryKeys } from '../../../shared/api';
import fixture from '../../../../../contracts/ai/conversations/v1/completed.json';
import conversationFixture from '../../../../../contracts/ai/conversations/v1/conversation.json';
import emptyFixture from '../../../../../contracts/ai/questions/v1/no-evidence.json';
import type { QuestionResponse } from '../api/questionApi';
import type { Citation } from '../api/generationApi';
jest.mock('../api/conversationApi');
jest.mock('../api/citationEvidence');
const turn = fixture as api.ConversationTurn;
const conversation = conversationFixture as api.Conversation;
const ready = {
  sources: [
    { id: 's1', title: 'Lecture', sourceType: 'PDF', ready: true },
    { id: 's2', title: 'Notes', sourceType: 'TXT', ready: true },
    { id: 's3', title: 'Processing', ready: false },
  ],
  loading: false,
  error: null,
};
const stream = jest.mocked(api.streamConversationQuestion);
const history = jest.mocked(api.fetchConversationHistory);
const list = jest.mocked(api.fetchConversations);
const quote = jest.mocked(fetchCitationFragment);
function setup(props: Partial<ResearchPanelProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ResearchPanel variant="page" workspaceId="w1" sources={ready} {...props} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...view, client };
}
async function ask() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: 'What is kinetic energy?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask research question' }));
  await screen.findByRole('region', { name: 'Evidence' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
}
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  jest.resetAllMocks();
  list.mockResolvedValue({ items: [], nextOffset: null });
  history.mockResolvedValue({ conversation, messages: [], nextBeforeSequence: null });
  jest.mocked(api.createConversation).mockResolvedValue(conversation);
  stream.mockResolvedValue(turn);
  quote.mockImplementation(async (citation) => ({
    ...citation,
    content: 'Original cited words, never a model-generated quote.',
  }));
});
it('groups conversations by recency and changes investigations without losing pagination', async () => {
  const today = new Date();
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
    12,
  );
  const items = [
    {
      ...conversation,
      id: 'today',
      title: 'Today question',
      updatedAt: today.toISOString(),
    },
    {
      ...conversation,
      id: 'yesterday',
      title: 'Yesterday question',
      updatedAt: yesterday.toISOString(),
    },
    {
      ...conversation,
      id: 'earlier',
      title: 'Earlier question',
      updatedAt: '2001-01-01',
    },
  ];
  list.mockImplementation(async (_workspaceId, offset = 0) =>
    offset === 0 ? { items, nextOffset: 3 } : { items: [], nextOffset: null },
  );
  setup();
  await screen.findByRole('button', { name: 'Yesterday question' });
  expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Yesterday' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Earlier' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Earlier question' }));
  await waitFor(() =>
    expect(history).toHaveBeenCalledWith('w1', 'earlier', null, expect.any(AbortSignal)),
  );
  fireEvent.click(screen.getByRole('button', { name: 'More conversations' }));
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith('w1', 3, expect.any(AbortSignal)),
  );
  fireEvent.click(screen.getByRole('button', { name: 'New question' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Ask AI' })).toBeTruthy();
});
it('inspects a citation with its exact quote and opens the cited PDF page', async () => {
  setup();
  await ask();
  expect(screen.getByRole('link', { name: 'Inspect citation S1' }).getAttribute('href')).toContain('unit=unit-38&page=38');
  fireEvent.click(screen.getByRole('button', { name: 'Show support for claim 1, S1' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  const panel = screen.getByRole('region', { name: 'Citation' });
  expect(
    await within(panel).findByText(
      'Original cited words, never a model-generated quote.',
    ),
  ).toBeTruthy();
  expect(within(panel).getByText('Page 38')).toBeTruthy();
  expect(
    within(panel).getByRole('link', { name: 'Open source' }).getAttribute('href'),
  ).toContain('unit=unit-38&page=38');
  fireEvent.click(screen.getByRole('button', { name: 'Change scope' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
});
it('asks a single source, reruns with All/This source/Selected, and preserves an explicit empty selection', async () => {
  setup({ initialSourceId: 's1' });
  expect(screen.getByText('Only this source is used.')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: 'What is kinetic energy?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask research question' }));
  await screen.findByRole('region', { name: 'Where it says so' });
  expect(stream.mock.calls[0]?.[2].selectedSourceIds).toEqual(['s1']);
  await waitFor(() =>
    expect(screen.getByLabelText('All workspace sources')).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByLabelText('All workspace sources'));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
  expect(stream.mock.calls[1]?.[2].selectedSourceIds).toBeUndefined();
  await waitFor(() =>
    expect(screen.getByLabelText('This source')).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByLabelText('This source'));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(3));
  expect(stream.mock.calls[2]?.[2].selectedSourceIds).toEqual(['s1']);
  await waitFor(() =>
    expect(screen.getByLabelText('Selected sources')).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByLabelText('Selected sources'));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(4));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(
    screen.getByText('No sources selected. The answer will have no evidence.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply scope' }));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(5));
  expect(stream.mock.calls[4]?.[2].selectedSourceIds).toEqual([]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select all ready' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select all ready' }));
  expect(screen.getByLabelText('Notes')).toHaveProperty('checked', true);
  fireEvent.click(screen.getByLabelText('Notes'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply scope' }));
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(6));
  expect(stream.mock.calls[5]?.[2].selectedSourceIds).toEqual(['s1']);
  expect(screen.getByRole('link', { name: 'Open page' }).getAttribute('href')).toContain(
    'page=38',
  );
});
it('offers a neutral insufficient-evidence callout and reruns across all sources', async () => {
  const empty = emptyFixture as QuestionResponse;
  stream.mockResolvedValueOnce({
    ...turn,
    assistant: { ...turn.assistant, response: empty, content: empty.answer },
  });
  setup({ initialSourceId: 's1' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Research question'), {
    target: { value: 'No evidence?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask research question' }));
  const button = await screen.findByRole('button', { name: 'Ask all sources instead' });
  await waitFor(() => expect(button).toHaveProperty('disabled', false));
  fireEvent.click(button);
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
  expect(stream.mock.calls[1]?.[2].selectedSourceIds).toBeUndefined();
});
it('consumes an overview question once under StrictMode after sources become ready', async () => {
  const used = jest.fn();
  setup({
    initialQuestion: { question: 'Overview question', selectedSourceIds: ['s2'] },
    onInitialQuestionUsed: used,
  });
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  expect(used).toHaveBeenCalledTimes(1);
  expect(stream.mock.calls[0]?.[2]).toMatchObject({
    question: 'Overview question',
    selectedSourceIds: ['s2'],
  });
});
it('restores the recorded scope when reloading history', async () => {
  list.mockResolvedValue({ items: [conversation], nextOffset: null });
  history.mockResolvedValue({
    conversation,
    messages: [{ ...turn.user, selectedSourceIds: ['s2'] }, turn.assistant],
    nextBeforeSequence: null,
  });
  setup();
  await waitFor(() =>
    expect(screen.getByLabelText('Selected sources')).toHaveProperty('checked', true),
  );
  expect(screen.getByLabelText('Notes')).toHaveProperty('checked', true);
  expect(screen.getByText('Scope: Notes')).toBeTruthy();
});
it('prevents a non-ready or unavailable single source from being sent and shows conversation failures', async () => {
  list.mockRejectedValue(new Error('Cannot read conversations'));
  setup({ initialSourceId: 's3' });
  await screen.findByText(/Could not load conversations/);
  expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByText('This source is not ready for questions.')).toBeTruthy();
});
it('does not display a stale passage when access is revoked', async () => {
  const citation = turn.assistant.response?.citations[0] as Citation;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    queryKeys.citationFragment(
      citation.workspaceId,
      citation.sourceId,
      citation.processingVersion,
      citation.chunkId,
      citation.sourceVersionId,
      citation.contentHash,
    ),
    { ...citation, content: 'Stale private quote' },
  );
  quote.mockRejectedValue(
    new ApiError({
      type: 'about:blank',
      title: 'Unavailable',
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      rawCode: 'RESOURCE_NOT_FOUND',
      detail: 'Not available',
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <CitationPanel selected={{ citation, label: 'S1', sourceType: 'PDF' }} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('Not available'),
  );
  expect(screen.queryByText('Stale private quote')).toBeNull();
});
it('preserves claim-to-citation support and handles historical answers without generation metadata', async () => {
  const response = turn.assistant.response as QuestionResponse;
  const original = response.generation!;
  const citation = {
    ...response.citations[0]!,
    title: null,
    sectionTitle: 'Methods',
    pageStart: null,
    pageEnd: null,
  };
  const onInspect = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = (generated: boolean) => (
    <QueryClientProvider client={client}>
      <ResearchAnswer
        response={{
          ...response,
          answer: 'Historical answer',
          citations: [citation],
          generation: generated
            ? {
                ...original,
                context: null,
                result: {
                  ...original.result,
                  answer: {
                    status: 'SUPPORTED',
                    claims: [
                      {
                        text: 'Supported claim',
                        evidenceIds: [citation.chunkId, 'missing'],
                      },
                    ],
                  },
                },
              }
            : null,
        }}
        sources={ready}
        selected={null}
        onInspect={onInspect}
        sourceView={false}
        onAskAll={jest.fn()}
        disabled={false}
      />
    </QueryClientProvider>
  );
  const view = render(result(true));
  expect(screen.getByRole('alert').textContent).toBe('Source reference is unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Show support for claim 1, S1' }));
  expect(onInspect).toHaveBeenCalledWith({ citation, label: 'S1', sourceType: 'Source' });
  fireEvent.keyDown(document, { key: 'Escape' });
  view.rerender(result(false));
  expect(screen.getByText('Historical answer')).toBeTruthy();
  expect(screen.getByRole('link', { name: '[S1] Methods · Methods' })).toBeTruthy();
  await screen.findByText('Original cited words, never a model-generated quote.');
});
it('labels page ranges, sections and unknown locations and dates without inventing metadata', () => {
  const citation = turn.assistant.response?.citations[0] as Citation;
  expect(citationLocation({ ...citation, pageStart: 1, pageEnd: 3 })).toBe('Pages 1–3');
  expect(
    citationLocation({ ...citation, pageStart: null, sectionTitle: 'Methods' }),
  ).toBe('Methods');
  expect(citationLocation({ ...citation, pageStart: null, sectionTitle: null })).toBe(
    'Source fragment',
  );
  expect(scopeLabel('source', [], ready, 'missing')).toBe('This source');
  expect(conversationRecency('bad date')).toBe('Earlier');
});
