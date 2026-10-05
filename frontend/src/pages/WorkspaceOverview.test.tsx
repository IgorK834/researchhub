/** @jest-environment jsdom */
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorkspaceDetailPage } from './WorkspaceDetailPage';
import * as conversations from '../features/ai/api/conversationApi';
import turnFixture from '../../../contracts/ai/conversations/v1/completed.json';
import conversationFixture from '../../../contracts/ai/conversations/v1/conversation.json';
import emptyAnswer from '../../../contracts/ai/questions/v1/no-evidence.json';

const timestamp = '2026-10-02T10:00:00Z';
const workspace = {
  id: 'w1',
  name: 'Electronics Lab',
  description: 'Team 4 research',
  role: 'OWNER',
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const source = {
  id: 's1',
  displayName: 'Ready paper',
  sourceType: 'PDF',
  status: 'READY',
  updatedAt: timestamp,
};
const originalFetch = globalThis.fetch;
function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: {
      get: () => (status >= 400 ? 'application/problem+json' : 'application/json'),
    },
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
  } as unknown as Response;
}
function api(
  options: {
    role?: string;
    description?: string | null;
    archived?: boolean;
    documents?: unknown[];
    sources?: unknown[];
    members?: unknown[];
    conversations?: unknown[];
    failures?: string[];
    pending?: boolean;
  } = {},
) {
  const collections: Record<string, unknown> = {
    documents: options.documents ?? [],
    sources: options.sources ?? [source],
    members: options.members ?? [
      { userId: 'ada', displayName: 'Ada Lovelace', role: 'OWNER' },
    ],
    'ai/conversations?offset=0': { items: options.conversations ?? [], nextOffset: null },
  };
  const mock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/auth/csrf') return Promise.resolve(json(null, 204));
    if (path.endsWith('/ai/questions')) return Promise.resolve(json(emptyAnswer));
    if (path.endsWith('/ai/conversations') && init?.method === 'POST')
      return Promise.resolve(json(conversationFixture, 201));
    if (path.includes('/ai/conversations/') && init?.method === 'GET')
      return Promise.resolve(
        json({
          conversation: conversationFixture,
          messages: [],
          nextBeforeSequence: null,
        }),
      );
    if (path === '/api/workspaces/w1')
      return Promise.resolve(
        json({
          ...workspace,
          role: options.role ?? 'OWNER',
          description:
            options.description === undefined
              ? workspace.description
              : options.description,
          archivedAt: options.archived ? timestamp : null,
        }),
      );
    const key = path.replace('/api/workspaces/w1/', '');
    if (!(key in collections))
      throw new Error('Unexpected request: ' + init?.method + ' ' + path);
    if (options.pending) return new Promise<Response>(() => undefined);
    if (options.failures?.includes(key))
      return Promise.resolve(
        json(
          {
            type: 'about:blank',
            title: 'Error',
            status: 500,
            code: 'INTERNAL_ERROR',
            detail: 'Unavailable',
          },
          500,
        ),
      );
    return Promise.resolve(json(collections[key]));
  });
  globalThis.fetch = mock;
  return mock;
}
function Location(): ReactNode {
  const location = useLocation();
  return (
    <output aria-label="Location">
      {location.pathname} · {JSON.stringify(location.state)}
    </output>
  );
}
function page(entry = '/app/workspaces/w1', strict = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const element = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route path="/app/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route
            path="/app/workspaces/:workspaceId/ask"
            element={<WorkspaceDetailPage section="ask" />}
          />
          <Route
            path="/app/workspaces/:workspaceId/settings"
            element={<WorkspaceDetailPage section="settings" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{element}</StrictMode> : element);
  return client;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('composes the hero and recent collections with exact data, ordering and no per-row requests', async () => {
  const documents = [1, 4, 2, 3].map((n) => ({
    id: 'd' + n,
    title: 'Document ' + n,
    revision: n,
    updatedAt: `2026-10-0${n}T10:00:00Z`,
  }));
  const sources = ['UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'READY'].map(
    (status, i) => ({
      ...source,
      id: 's' + i,
      status,
      displayName: 'Source ' + i,
      sourceType: i === 4 ? 'XLSX' : i === 3 ? 'CSV' : 'PDF',
      updatedAt: `2026-10-0${i + 1}T10:00:00Z`,
    }),
  );
  const mock = api({
    documents,
    sources,
    members: ['Ada', 'Kasia', 'Michał', 'Marta'].map((name) => ({
      userId: name,
      displayName: name,
    })),
    conversations: [1, 2, 3, 4].map((n) => ({
      id: 'c' + n,
      title: 'Research ' + n,
      updatedAt: timestamp,
    })),
  });
  page();
  await screen.findByRole('heading', { name: workspace.name });
  expect(screen.getByText('Team 4 research')).toBeTruthy();
  expect(screen.getByText('Owner')).toBeTruthy();
  const people = await screen.findByRole('group', { name: 'Workspace members' });
  expect(within(people).getByRole('img', { name: '1 more people: Marta' })).toBeTruthy();
  expect(await screen.findByText('Grounded in 2 sources')).toBeTruthy();
  const docs = screen.getByRole('region', { name: 'Recent documents' });
  expect(
    within(docs)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['All documents', 'Document 4', 'Document 3', 'Document 2']);
  expect(
    within(docs).getByRole('link', { name: 'Document 4' }).getAttribute('href'),
  ).toBe('/app/workspaces/w1/documents/d4');
  expect(within(docs).getByText(/v4/)).toBeTruthy();
  const sourcesCard = screen.getByRole('region', { name: 'Recent sources' });
  expect(
    within(sourcesCard)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('a')?.textContent),
  ).toEqual(['Source 4', 'Source 3', 'Source 2', 'Source 1']);
  expect(within(sourcesCard).getByText('Failed')).toBeTruthy();
  expect(within(sourcesCard).getByText('Processing')).toBeTruthy();
  expect(within(sourcesCard).getAllByText('Ready')).toHaveLength(2);
  expect(
    within(sourcesCard).getByRole('link', { name: 'Source 4' }).getAttribute('href'),
  ).toBe('/app/workspaces/w1/sources/s4');
  const activity = screen.getByRole('region', { name: 'Recent AI activity' });
  expect(within(activity).getAllByRole('listitem')).toHaveLength(3);
  expect(within(activity).getByText('Research 1')).toBeTruthy();
  expect(activity.querySelector('time')?.dateTime).toBe(timestamp);
  expect(mock.mock.calls).toHaveLength(5);
  expect(screen.queryByText('Continue working')).toBeNull();
  expect(screen.queryByText('Workspace activity')).toBeNull();
  expect(screen.queryByText('Recent analyses')).toBeNull();
});
it('shows uploaded status, known zero counts and independent empty states for a viewer', async () => {
  api({
    role: 'VIEWER',
    description: null,
    sources: [{ ...source, status: 'UPLOADED' }],
    members: [],
  });
  page();
  expect(await screen.findByText('Grounded in 0 sources')).toBeTruthy();
  expect(screen.getByText('No description.')).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Recent sources' })).getByText('Uploaded'),
  ).toBeTruthy();
  expect(screen.getByText('No documents yet.')).toBeTruthy();
  expect(await screen.findByText('No AI conversations yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /create|upload/i })).toBeNull();
});
it('keeps empty sources and archived content readable with no write controls', async () => {
  api({ sources: [], archived: true });
  page();
  expect(await screen.findByText('No sources yet.')).toBeTruthy();
  expect(screen.getByText('This workspace is archived.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /create|upload/i })).toBeNull();
});
it('announces loading collections without inventing counts', async () => {
  api({ pending: true });
  page();
  await screen.findByRole('heading', { name: workspace.name });
  expect(screen.getByText('Loading documents…')).toBeTruthy();
  expect(screen.getByText('Loading sources…')).toBeTruthy();
  expect(screen.getByText('Loading AI conversations…')).toBeTruthy();
  expect(screen.queryByText(/Grounded in/)).toBeNull();
});
it('reports collection failures independently without showing stale data or zero counts', async () => {
  api({ failures: ['documents', 'sources', 'members', 'ai/conversations?offset=0'] });
  page();
  // The fixture is installed before the initially scheduled workspace response settles.
  await screen.findByRole('heading', { name: workspace.name });
  expect(await screen.findByText('Could not load documents')).toBeTruthy();
  expect(await screen.findByText('Could not load sources')).toBeTruthy();
  expect(await screen.findByText('Could not load workspace members')).toBeTruthy();
  expect(await screen.findByText('Could not load AI conversations')).toBeTruthy();
  expect(screen.queryByText(/Grounded in/)).toBeNull();
  expect(screen.queryByText('No documents yet.')).toBeNull();
});
it.each([false, true])(
  'submits the overview question to Ask AI once with its selected scope (selected=%s)',
  async (selected) => {
    api();
    const turn = turnFixture as conversations.ConversationTurn;
    const stream = jest
      .spyOn(conversations, 'streamConversationQuestion')
      .mockResolvedValue({
        ...turn,
        assistant: {
          ...turn.assistant,
          content: emptyAnswer.answer,
          response:
            emptyAnswer as conversations.ConversationTurn['assistant']['response'],
        },
      });
    page('/app/workspaces/w1', true);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Ask question' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    if (selected) {
      fireEvent.click(screen.getByLabelText('Selected sources'));
      fireEvent.click(screen.getByLabelText('Ready paper'));
    }
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: '  What does the paper support?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
    expect(await screen.findByText(emptyAnswer.answer)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText('Location').textContent).toBe(
        '/app/workspaces/w1/ask · null',
      ),
    );
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[2]).toEqual({
      clientRequestId: expect.any(String),
      question: 'What does the paper support?',
      ...(selected ? { selectedSourceIds: ['s1'] } : {}),
    });
    expect(screen.getByRole('textbox', { name: 'Research question' })).toHaveProperty(
      'value',
      '',
    );
  },
);
it.each(['VIEWER', 'REVIEWER'])(
  'redirects %s away from settings without management controls',
  async (role) => {
    api({ role });
    page('/app/workspaces/w1/settings');
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeTruthy();
    expect(screen.getByLabelText('Location').textContent).toBe(
      '/app/workspaces/w1 · null',
    );
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull();
  },
);
