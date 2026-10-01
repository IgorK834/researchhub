/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthoringPanel } from './AuthoringPanel';
import {
  acceptAuthoring,
  rejectAuthoring,
  suggestAuthoring,
  type AuthoringSuggestion,
} from '../api/authoringApi';
import type { Citation } from '../api/generationApi';

let mockSources: {
  data?: readonly { id: string; status: string; displayName: string }[];
  error: Error | null;
  isPending: boolean;
};
jest.mock('../../sources/api/useSources', () => ({ useSourcesQuery: () => mockSources }));
jest.mock('../api/authoringApi', () => ({
  acceptAuthoring: jest.fn(),
  rejectAuthoring: jest.fn(),
  suggestAuthoring: jest.fn(),
}));
const suggest = jest.mocked(suggestAuthoring),
  accept = jest.mocked(acceptAuthoring),
  reject = jest.mocked(rejectAuthoring);
const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: null,
  chunkId: 'a'.repeat(64),
  processingVersion: 'v1',
  contentHash: 'b'.repeat(64),
  pageStart: 7,
  pageEnd: 7,
  sectionTitle: 'Theory',
  title: 'Lecture',
  spans: [{ unitId: 'p7', characterStart: 0, characterEnd: 30 }],
};
const model = {
  provider: 'fake',
  name: 'fixture',
  version: '1',
  structuredOutput: true,
  streaming: false,
} as const;
const proposal: AuthoringSuggestion = {
  id: 'proposal',
  workspaceId: 'w',
  documentId: 'd',
  createdBy: 'u',
  state: 'PENDING',
  command: {
    kind: 'DRAFT',
    expectedRevision: 1,
    placementBlock: 1,
    from: null,
    to: null,
    action: null,
    instruction: 'Theory',
    selectedSourceIds: ['s'],
    lengthTarget: 300,
    stylePreset: 'ACADEMIC',
    citationRequired: true,
  },
  originalText: '',
  generatedText: 'Generated section.',
  citations: [citation],
  candidates: [],
  warnings: ['Review generated claims.'],
  generation: {
    requestId: 'g',
    templateId: 'draft:1',
    model,
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimated: true },
  },
  acceptedRevision: null,
};
const accepted = {
  eventId: 'proposal',
  acceptedRevision: 2,
  document: {
    id: 'd',
    title: 'Report',
    revision: 2,
    contentFormat: 'PROSEMIRROR_JSON',
    createdAt: 'now',
    updatedAt: 'now',
    archivedAt: null,
    content: { type: 'doc', content: [] },
  },
};
const onBusy = jest.fn(),
  onAccepted = jest.fn(),
  onReload = jest.fn();
const base = {
  workspaceId: 'w',
  documentId: 'd',
  revision: 1,
  settled: true,
  selection: { from: 1, to: 13, text: 'Human claim.', placementBlock: 1 },
  blockCount: 2,
  onBusy,
  onAccepted,
  onReload,
};
function view(props: Partial<typeof base> = {}) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthoringPanel {...base} {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
async function draft() {
  fireEvent.change(screen.getByLabelText('Title or instruction'), {
    target: { value: 'Theory' },
  });
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
}
beforeEach(() => {
  jest.resetAllMocks();
  mockSources = {
    data: [{ id: 's', displayName: 'Lecture', status: 'READY' }],
    error: null,
    isPending: false,
  };
  suggest.mockResolvedValue(proposal);
  accept.mockResolvedValue(accepted);
  reject.mockResolvedValue({ ...proposal, state: 'REJECTED' });
});
afterEach(cleanup);
test('draft is reviewed, edited and accepted once; before approval no document mutation occurs', async () => {
  render(view());
  await draft();
  expect(onAccepted).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  expect(
    screen.getByRole('link', { name: 'Lecture — page 7' }).getAttribute('href'),
  ).toEqual(expect.stringContaining('processingVersion=v1'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit suggestion'), {
    target: { value: 'Human reviewed.' },
  });
  const button = screen.getByRole('button', { name: 'Accept' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted.document));
  expect(accept).toHaveBeenCalledTimes(1);
  expect(accept).toHaveBeenCalledWith('w', 'd', 'proposal', {
    expectedRevision: 1,
    editedText: 'Human reviewed.',
    citationChunkId: null,
  });
  expect(suggest.mock.calls[0]?.[2].selectedSourceIds).toEqual(['s']);
});
test('reject discards only the suggestion and handles rejection failure', async () => {
  render(view());
  await draft();
  reject.mockRejectedValueOnce(new Error('Rejected request failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'AI suggestion' })).toBeNull(),
  );
  expect(accept).not.toHaveBeenCalled();
  expect(onAccepted).not.toHaveBeenCalled();
});
test('rewrite shows original and replacement as a diff and sends the saved range with no sources', async () => {
  suggest.mockResolvedValue({
    ...proposal,
    command: { ...proposal.command, kind: 'REWRITE' },
    originalText: 'Human claim.',
    citations: [],
  });
  render(view());
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'REWRITE' } });
  fireEvent.change(screen.getByLabelText('Rewrite action'), {
    target: { value: 'SHORTEN' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(screen.getByLabelText('Suggestion diff').querySelector('del')?.textContent).toBe(
    'Human claim.',
  );
  expect(screen.getByLabelText('Suggestion diff').querySelector('ins')?.textContent).toBe(
    'Generated section.',
  );
  expect(suggest.mock.calls[0]?.[2]).toMatchObject({
    from: 1,
    to: 13,
    action: 'SHORTEN',
    selectedSourceIds: [],
    citationRequired: false,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(accept).toHaveBeenCalled());
  expect(accept.mock.calls[0]?.[3].editedText).toBeNull();
});
test('optional grounded expansion sends only checked sources and configured length/style', async () => {
  render(view());
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'REWRITE' } });
  fireEvent.change(screen.getByLabelText('Rewrite action'), {
    target: { value: 'EXPAND' },
  });
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.change(screen.getByLabelText('Length target (words)'), {
    target: { value: '100' },
  });
  fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'PLAIN' } });
  fireEvent.click(screen.getByLabelText('Require citations for source-grounded output'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(suggest.mock.calls[0]?.[2]).toMatchObject({
    action: 'EXPAND',
    selectedSourceIds: ['s'],
    citationRequired: false,
    lengthTarget: 100,
    stylePreset: 'PLAIN',
  });
});
test('evidence displays categories, snippets, location and relevance and inserts only a citation', async () => {
  const candidates = [
    {
      citation,
      snippet: 'Source evidence.',
      category: 'supporting',
      relevance: 0.9,
      reason: 'Direct support',
    },
    {
      citation: {
        ...citation,
        chunkId: 'b'.repeat(64),
        title: null,
        pageStart: null,
        sectionTitle: null,
      },
      snippet: 'Context.',
      category: 'related',
      relevance: 0.4,
      reason: 'Partial support',
    },
    {
      citation: { ...citation, chunkId: 'c'.repeat(64), pageStart: null },
      snippet: 'Other.',
      category: 'insufficient',
      relevance: 0.1,
      reason: 'Insufficient',
    },
  ] as const;
  suggest.mockResolvedValue({
    ...proposal,
    command: { ...proposal.command, kind: 'EVIDENCE' },
    generatedText: '',
    candidates,
    generation: null,
  });
  render(view());
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'EVIDENCE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByText('supporting — relevance 90%');
  expect(suggest.mock.calls[0]?.[2].selectedSourceIds).toBeNull();
  expect(screen.getByText('Source evidence.')).toBeTruthy();
  const buttons = screen.getAllByRole('button', { name: 'Add citation' });
  expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(buttons[0] as HTMLElement);
  await waitFor(() =>
    expect(accept).toHaveBeenCalledWith('w', 'd', 'proposal', {
      expectedRevision: 1,
      editedText: null,
      citationChunkId: citation.chunkId,
    }),
  );
});
test('failed acceptance freezes the payload; retry uses the same identity and text', async () => {
  accept.mockRejectedValueOnce(new Error('Network interruption'));
  render(view());
  await draft();
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await screen.findByRole('alert');
  expect(onBusy).toHaveBeenLastCalledWith(true);
  expect(
    (screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Load latest document' }));
  expect(onReload).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry acceptance' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
});
test('stale suggestion disables acceptance and requests a new proposal', async () => {
  const rendered = render(view());
  await draft();
  rendered.rerender(view({ revision: 2 }));
  expect(
    (screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('document changed');
});
test('draft validates source selection, supports explicit placement and reports generation failure', async () => {
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('alert');
  expect(suggest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Insert section'), { target: { value: '0' } });
  suggest.mockRejectedValueOnce(new Error('Provider failed'));
  fireEvent.change(screen.getByLabelText('Title or instruction'), {
    target: { value: 'Theory' },
  });
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'An unexpected error occurred',
    ),
  );
  expect(suggest.mock.calls[0]?.[2].placementBlock).toBe(0);
});
test('missing selection and unsaved document cannot request rewrite', async () => {
  const rendered = render(view({ selection: { ...base.selection, text: '' } }));
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'REWRITE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByRole('alert');
  expect(suggest).not.toHaveBeenCalled();
  rendered.rerender(view({ settled: false }));
  expect(
    (screen.getByRole('button', { name: 'Generate suggestion' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
test('selected evidence scope with no hits offers rejection only', async () => {
  mockSources = { data: [], error: null, isPending: false };
  suggest.mockResolvedValue({
    ...proposal,
    command: { ...proposal.command, kind: 'EVIDENCE' },
    candidates: [],
    generatedText: '',
    generation: null,
  });
  render(view());
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'EVIDENCE' } });
  fireEvent.click(screen.getByLabelText('Search all workspace sources'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
  await screen.findByText('Insufficient evidence.');
  expect(suggest.mock.calls[0]?.[2].selectedSourceIds).toEqual([]);
});
test('source loading failures are visible and block generation', () => {
  mockSources = { error: new Error('Sources unavailable'), isPending: false };
  render(view());
  expect(screen.getByRole('alert').textContent).toContain('An unexpected error occurred');
  expect(
    (screen.getByRole('button', { name: 'Generate suggestion' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
