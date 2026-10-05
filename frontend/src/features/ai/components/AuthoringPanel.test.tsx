/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  act,
  within,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { SELECTION_ACTIONS } from '../api/authoringActions';
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
  data?: readonly {
    id: string;
    status: string;
    displayName: string;
    sourceType: string;
  }[];
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
function view(props: Partial<ComponentProps<typeof AuthoringPanel>> = {}) {
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
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByRole('region', { name: 'AI draft' });
}
beforeEach(() => {
  jest.resetAllMocks();
  mockSources = {
    data: [{ id: 's', displayName: 'Lecture', status: 'READY', sourceType: 'PDF' }],
    error: null,
    isPending: false,
  };
  suggest.mockImplementation(async (_workspaceId, _documentId, command) => ({
    ...proposal,
    command,
  }));
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
  const button = screen.getByRole('button', { name: 'Insert draft' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted.document));
  expect(accept).toHaveBeenCalledTimes(1);
  expect(accept).toHaveBeenCalledWith('w', 'd', 'proposal', {
    expectedRevision: 1,
    editedText: null,
    citationChunkId: null,
  });
  expect(suggest.mock.calls[0]?.[2].selectedSourceIds).toEqual(['s']);
});
test('reject discards only the suggestion and handles rejection failure', async () => {
  render(view());
  await draft();
  reject.mockRejectedValueOnce(new Error('Rejected request failed'));
  fireEvent.click(screen.getByRole('button', { name: /Reject|Discard/ }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /Reject|Discard/ }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'AI draft' })).toBeNull(),
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
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit suggestion'), {
    target: { value: 'Human reviewed.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(accept).toHaveBeenCalled());
  expect(accept.mock.calls[0]?.[3].editedText).toBe('Human reviewed.');
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
  fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'PLAIN' } });
  fireEvent.click(screen.getByLabelText('Require citations for source-grounded output'));
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(suggest.mock.calls[0]?.[2]).toMatchObject({
    action: 'EXPAND',
    selectedSourceIds: ['s'],
    citationRequired: false,
    lengthTarget: 100,
    stylePreset: 'PLAIN',
  });
});
test('evidence displays categories, snippets and location and inserts only a citation', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByText('Supporting evidence');
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
  fireEvent.click(screen.getByRole('button', { name: 'Insert draft' }));
  await screen.findByRole('alert');
  expect(onBusy).toHaveBeenLastCalledWith(true);
  expect(
    (screen.getByRole('button', { name: /Reject|Discard/ }) as HTMLButtonElement)
      .disabled,
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
    (screen.getByRole('button', { name: 'Insert draft' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('document changed');
});

test.each(['REWRITE', 'EVIDENCE'] as const)(
  '%s approval checks the saved revision while rejection leaves the document unchanged',
  async (kind) => {
    suggest.mockImplementation(async (_w, _d, command) => ({
      ...proposal,
      command,
      originalText: base.selection.text,
      candidates:
        kind === 'EVIDENCE'
          ? [
              {
                citation,
                snippet: 'Direct support.',
                category: 'supporting',
                relevance: 0.8,
                reason: '',
              },
            ]
          : [],
    }));
    const rendered = render(view());
    fireEvent.change(screen.getByLabelText('Operation'), { target: { value: kind } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByRole('region', { name: 'AI suggestion' });
    rendered.rerender(view({ settled: false }));
    expect(
      screen.getByRole('button', {
        name: kind === 'REWRITE' ? 'Accept' : 'Add citation',
      }),
    ).toHaveProperty('disabled', true);
    rendered.rerender(view({ revision: 2 }));
    expect(screen.getByRole('alert').textContent).toContain('document changed');
    expect(
      screen.getByRole('button', {
        name: kind === 'REWRITE' ? 'Accept' : 'Add citation',
      }),
    ).toHaveProperty('disabled', true);
    if (kind === 'REWRITE')
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveProperty(
        'disabled',
        true,
      );
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('w', 'd', 'proposal'));
    expect(accept).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  },
);

test('edited rewrite retries its frozen payload and renders at the captured selection boundary', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const placement = jest.fn();
  accept.mockRejectedValueOnce(new Error('Interrupted response'));
  const rendered = render(
    view({
      draftHost: host,
      onDraftPlacementChange: placement,
      selectionRequest: {
        id: 1,
        action: 'SHORTEN',
        revision: 1,
        selection: base.selection,
      },
    }),
  );
  await screen.findByRole('region', { name: 'AI suggestion' });
  expect(host.contains(screen.getByRole('region', { name: 'AI suggestion' }))).toBe(true);
  expect(placement).toHaveBeenLastCalledWith(1, 13);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Edit suggestion'), {
    target: { value: 'Reviewed rewrite.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Edit suggestion' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Reject' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry acceptance' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted.document));
  expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
  expect(accept.mock.calls[1]?.[3]).toEqual({
    expectedRevision: 1,
    editedText: 'Reviewed rewrite.',
    citationChunkId: null,
  });
  rendered.unmount();
  host.remove();
});

test('interrupted evidence insertion can retry only the same citation', async () => {
  suggest.mockImplementation(async (_w, _d, command) => ({
    ...proposal,
    command,
    originalText: base.selection.text,
    candidates: [
      {
        citation,
        snippet: 'Passage.',
        category: 'supporting',
        relevance: 0.8,
        reason: '',
      },
      {
        citation: { ...citation, chunkId: 'c'.repeat(64) },
        snippet: 'Context.',
        category: 'related',
        relevance: 0.4,
        reason: '',
      },
    ],
  }));
  accept.mockRejectedValueOnce(new Error('Interrupted response'));
  render(
    view({
      selectionRequest: {
        id: 2,
        action: 'FIND_EVIDENCE',
        revision: 1,
        selection: base.selection,
      },
    }),
  );
  await screen.findByRole('region', { name: 'AI suggestion' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add citation' })[0]!);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Add citation' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry citation' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalled());
  expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
});
test('draft validates source selection, supports explicit placement and reports generation failure', async () => {
  render(view());
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByRole('alert');
  expect(suggest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Insert section'), { target: { value: '0' } });
  suggest.mockRejectedValueOnce(new Error('Provider failed'));
  fireEvent.change(screen.getByLabelText('Title or instruction'), {
    target: { value: 'Theory' },
  });
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
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
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByRole('alert');
  expect(suggest).not.toHaveBeenCalled();
  rendered.rerender(view({ settled: false }));
  expect(
    (
      screen.getByRole('button', {
        name: /Generate (draft|suggestion)/,
      }) as HTMLButtonElement
    ).disabled,
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
  fireEvent.click(screen.getByRole('button', { name: /Generate (draft|suggestion)/ }));
  await screen.findByText('No supporting evidence found.');
  fireEvent.click(screen.getByRole('button', { name: 'Keep claim as it is' }));
  await waitFor(() => expect(reject).toHaveBeenCalledWith('w', 'd', 'proposal'));
  expect(accept).not.toHaveBeenCalled();
  expect(suggest.mock.calls[0]?.[2].selectedSourceIds).toEqual([]);
});
test('source loading failures are visible and block generation', () => {
  mockSources = { error: new Error('Sources unavailable'), isPending: false };
  render(view());
  expect(screen.getByRole('alert').textContent).toContain('An unexpected error occurred');
  expect(
    (
      screen.getByRole('button', {
        name: /Generate (draft|suggestion)/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test.each(SELECTION_ACTIONS)(
  'toolbar %s sends exactly the same command as the panel using the captured selection',
  async (action) => {
    const kind = action === 'FIND_EVIDENCE' ? 'EVIDENCE' : 'REWRITE';
    suggest.mockImplementation(async (_w, _d, command) => ({ ...proposal, command }));
    render(view());
    fireEvent.change(screen.getByLabelText('Operation'), { target: { value: kind } });
    if (kind === 'REWRITE')
      fireEvent.change(screen.getByLabelText('Rewrite action'), {
        target: { value: action },
      });
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestion' }));
    await screen.findByRole('region', { name: 'AI suggestion' });
    const panelCommand = suggest.mock.calls[0]?.[2];
    cleanup();
    suggest.mockClear();
    render(
      view({
        selection: { from: 20, to: 25, text: 'Later', placementBlock: 2 },
        selectionRequest: { id: 1, action, revision: 1, selection: base.selection },
      }),
    );
    await screen.findByRole('region', { name: 'AI suggestion' });
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]?.[2]).toEqual(panelCommand);
    expect(accept).not.toHaveBeenCalled();
  },
);

test('a selection request waits for source loading and is processed once across rerenders', async () => {
  mockSources.isPending = true;
  const request = {
    id: 7,
    action: 'SHORTEN',
    revision: 1,
    selection: base.selection,
  } as const;
  const rendered = render(view({ selectionRequest: request }));
  expect(suggest).not.toHaveBeenCalled();
  mockSources.isPending = false;
  rendered.rerender(view({ selectionRequest: request }));
  await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
  rendered.rerender(view({ selectionRequest: { ...request } }));
  expect(suggest).toHaveBeenCalledTimes(1);
});

test.each([{ settled: false }, { revision: 2 }])(
  'unsaved or outdated selection requests cannot generate: %j',
  async (props) => {
    render(
      view({
        ...props,
        selectionRequest: {
          id: 1,
          action: 'EXPLAIN',
          revision: 1,
          selection: base.selection,
        },
      }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(suggest).not.toHaveBeenCalled();
  },
);

test('draft generation shows progress outside the saved document and locks double submits', async () => {
  let resolve!: (value: AuthoringSuggestion) => void;
  suggest.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  const placement = jest.fn();
  const reviewing = jest.fn();
  const rendered = render(
    view({ draftHost: host, onDraftPlacementChange: placement, onReviewing: reviewing }),
  );
  fireEvent.change(screen.getByLabelText('Title or instruction'), {
    target: { value: 'Theory' },
  });
  fireEvent.click(screen.getByLabelText('Lecture'));
  const button = screen.getByRole('button', { name: 'Generate draft' });
  fireEvent.submit(button.closest('form')!);
  fireEvent.submit(button.closest('form')!);
  expect(suggest).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Generating a source-grounded draft');
  expect(rendered.container.textContent).not.toContain(
    'AI draft — not in your document yet',
  );
  expect(placement).toHaveBeenCalledWith(1);
  await act(async () => {
    resolve(proposal);
  });
  expect(within(host).getByRole('region', { name: 'AI draft' })).toBeTruthy();
  expect(host.textContent).toContain('Grounded in 1 sources');
  expect(screen.getByText('Draft ready — 2 words')).toBeTruthy();
  expect(onAccepted).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  expect(reviewing).toHaveBeenCalledWith(true);
  fireEvent.click(within(host).getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(host.textContent).toBe(''));
  expect(placement).toHaveBeenLastCalledWith(null);
  expect(reviewing).toHaveBeenLastCalledWith(false);
  host.remove();
});

test('Insert and edit approves explicitly, survives an interrupted response and focuses the inserted block after retry', async () => {
  accept.mockRejectedValueOnce(new Error('Interrupted'));
  render(view());
  await draft();
  fireEvent.click(screen.getByRole('button', { name: 'Insert and edit' }));
  await screen.findByRole('alert');
  expect(
    (screen.getByRole('button', { name: 'Insert and edit' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry acceptance' }));
  await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted.document, 1));
  expect(accept.mock.calls[0]).toEqual(accept.mock.calls[1]);
});

test('regeneration rejects the old proposal before reusing its frozen sources, placement and preset', async () => {
  suggest.mockResolvedValueOnce(proposal).mockResolvedValueOnce({
    ...proposal,
    id: 'regenerated',
    generatedText: 'Another draft.',
  });
  render(view());
  await draft();
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  await screen.findByText('Another draft.');
  expect(reject).toHaveBeenCalledWith('w', 'd', 'proposal');
  expect(suggest.mock.calls[1]?.[2]).toEqual(proposal.command);
  expect(reject.mock.invocationCallOrder[0]).toBeLessThan(
    suggest.mock.invocationCallOrder[1]!,
  );
  expect(accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Insert draft' }));
  await waitFor(() =>
    expect(accept).toHaveBeenCalledWith('w', 'd', 'regenerated', expect.anything()),
  );
});

test('regeneration failure retains a proposal if rejection failed and permits a fresh request if generation failed', async () => {
  render(view());
  await draft();
  reject.mockRejectedValueOnce(new Error('Rejection failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Generated section.')).toBeTruthy();
  expect(suggest).toHaveBeenCalledTimes(1);
  suggest.mockRejectedValueOnce(new Error('Provider failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'AI draft' })).toBeNull(),
  );
  expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(
    (screen.getByRole('button', { name: 'Generate draft' }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test('insufficient evidence shows warnings, prevents insertion and can be discarded without editing the document', async () => {
  suggest.mockResolvedValue({
    ...proposal,
    generatedText: '',
    citations: [],
    generation: null,
    warnings: ['No retrieved support.'],
  });
  render(view());
  await draft();
  expect(screen.getByText('Insufficient evidence')).toBeTruthy();
  expect(screen.getByText('No retrieved support.')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Insert draft' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Insert and edit' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(reject).toHaveBeenCalled());
  expect(accept).not.toHaveBeenCalled();
});

test('draft length, placement, tone and required citations stay within the existing command contract', async () => {
  render(view());
  fireEvent.change(screen.getByLabelText('Insert section'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Length target/), { target: { value: '700' } });
  fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'CONCISE' } });
  const required = screen.getByLabelText(
    'Require citations for source-grounded output',
  ) as HTMLInputElement;
  expect(required.checked).toBe(true);
  expect(required.disabled).toBe(true);
  await draft();
  expect(suggest.mock.calls[0]?.[2]).toMatchObject({
    placementBlock: 2,
    lengthTarget: 700,
    stylePreset: 'CONCISE',
    citationRequired: true,
  });
});
