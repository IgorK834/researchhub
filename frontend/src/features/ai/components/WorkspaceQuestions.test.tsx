/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { WorkspaceQuestions } from './WorkspaceQuestions';
import type { QuestionResponse } from '../api/questionApi';
import fixture from '../../../../../contracts/ai/questions/v1/response.json';
import emptyFixture from '../../../../../contracts/ai/questions/v1/no-evidence.json';

const supported = fixture as QuestionResponse;
const empty = emptyFixture as QuestionResponse;
const ready = { id: 's1', displayName: 'Lecture', status: 'READY' };
const originalFetch = globalThis.fetch;
function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}
function requests(answer: QuestionResponse = supported, sources = [ready]): jest.Mock {
  const mock = jest.fn((url: unknown, _init?: RequestInit) =>
    Promise.resolve(
      String(url).endsWith('/sources')
        ? json(sources)
        : String(url).endsWith('/csrf')
          ? json(undefined, 204)
          : json(answer),
    ),
  );
  globalThis.fetch = mock;
  return mock;
}
function panel(workspaceId = 'w1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (id: string) => (
    <QueryClientProvider client={client}>
      <WorkspaceQuestions workspaceId={id} />
    </QueryClientProvider>
  );
  return { ...render(wrap(workspaceId)), wrap };
}
async function submit(question = 'What is kinetic energy?') {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0';
});

it('asks all sources by default and renders escaped claims with actual versioned citation links', async () => {
  const mock = requests();
  panel();
  await submit('  What is kinetic energy?  ');
  const link = await screen.findByRole('link', { name: '[S1] Lecture 5 · Page 38' });
  expect(link.getAttribute('href')).toContain(
    '/sources/10000000-0000-0000-0000-000000000003?processingVersion=retrieval-1%3Afixture&unit=unit-38&page=38',
  );
  expect(screen.getByText(supported.answer)).not.toBeNull();
  expect(screen.getByText('Question: What is kinetic energy?')).not.toBeNull();
  const post = mock.mock.calls.find((call) => String(call[0]).endsWith('/questions'));
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    question: 'What is kinetic energy?',
  });
});

it('opens Ask source with only that source selected and submits the existing question contract', async () => {
  const mock = requests(supported, [ready, { ...ready, id: 's2', displayName: 'Notes' }]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WorkspaceQuestions workspaceId="w1" initialSourceId="s1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByLabelText('Lecture')).toHaveProperty('checked', true);
  expect(screen.getByLabelText('Notes')).toHaveProperty('checked', false);
  expect(screen.getByLabelText('Question')).toHaveProperty('value', '');
  expect(mock.mock.calls.some(([url]) => String(url).endsWith('/questions'))).toBe(false);
  await submit('Summarize this source');
  await waitFor(() =>
    expect(mock.mock.calls.some(([url]) => String(url).endsWith('/questions'))).toBe(
      true,
    ),
  );
  const request = mock.mock.calls.find(([url]) => String(url).endsWith('/questions'));
  expect(JSON.parse((request?.[1] as RequestInit).body as string)).toEqual({
    question: 'Summarize this source',
    selectedSourceIds: ['s1'],
  });
});
it('searches only chosen READY sources and preserves an explicit empty selection', async () => {
  const mock = requests(empty, [
    ready,
    { id: 's2', displayName: 'Still processing', status: 'PROCESSING' },
  ]);
  panel();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByLabelText('Selected sources'));
  expect(screen.queryByLabelText('Still processing')).toBeNull();
  expect(
    screen.getByText('No sources selected. The answer will have no evidence.'),
  ).not.toBeNull();
  fireEvent.click(screen.getByLabelText('Lecture'));
  fireEvent.click(screen.getByLabelText('Lecture'));
  await submit();
  expect(await screen.findByText(empty.answer)).not.toBeNull();
  expect(
    JSON.parse(
      String(mock.mock.calls.find((c) => String(c[0]).endsWith('/questions'))?.[1]?.body),
    ),
  ).toEqual({ question: 'What is kinetic energy?', selectedSourceIds: [] });
  fireEvent.click(screen.getByLabelText('Lecture'));
  await submit();
  await waitFor(() =>
    expect(
      mock.mock.calls.filter((c) => String(c[0]).endsWith('/questions')),
    ).toHaveLength(2),
  );
  expect(
    JSON.parse(
      String(
        mock.mock.calls.filter((c) => String(c[0]).endsWith('/questions'))[1]?.[1]?.body,
      ),
    ).selectedSourceIds,
  ).toEqual(['s1']);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByLabelText('All workspace sources'));
});
it('shows no-ready-source and no-evidence states, and rejects blank questions locally', async () => {
  const mock = requests(empty, []);
  panel();
  expect(await screen.findByText(/No ready sources are available/)).not.toBeNull();
  await submit('  ');
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Enter a question.',
  );
  expect(mock.mock.calls.filter((c) => String(c[0]).endsWith('/questions'))).toHaveLength(
    0,
  );
  await submit();
  expect(await screen.findByText(empty.answer)).not.toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});
it('locks inputs while answering and hides results when a later request fails safely', async () => {
  let resolveAnswer!: (value: Response) => void;
  const mock = requests();
  mock.mockImplementation((url: unknown) =>
    String(url).endsWith('/questions')
      ? new Promise<Response>((resolve) => {
          resolveAnswer = resolve;
        })
      : Promise.resolve(
          String(url).endsWith('/sources') ? json([ready]) : json(undefined, 204),
        ),
  );
  panel();
  await submit();
  expect(await screen.findByText('Searching sources and answering…')).not.toBeNull();
  expect(screen.getByLabelText('Question')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Answering…' })).toHaveProperty(
    'disabled',
    true,
  );
  await act(async () => resolveAnswer(json(supported)));
  expect(await screen.findByText(supported.answer)).not.toBeNull();
  await submit('Another question');
  await waitFor(() =>
    expect(
      mock.mock.calls.filter((c) => String(c[0]).endsWith('/questions')),
    ).toHaveLength(2),
  );
  await act(async () =>
    resolveAnswer(
      json(
        {
          status: 413,
          code: 'AI_CONTEXT_TOO_LARGE',
          title: 'Budget',
          detail: 'Select fewer sources',
        },
        413,
      ),
    ),
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Select fewer sources',
  );
  expect(screen.queryByText(supported.answer)).toBeNull();
});
it('reports source-loading failures and disables submissions', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(
    json(
      {
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        title: 'Missing',
        detail: 'Workspace was not found',
      },
      404,
    ),
  );
  panel();
  expect(screen.getByText('Loading sources for questions…')).not.toBeNull();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not load question sources: Workspace was not found',
  );
  expect(screen.getByRole('button', { name: 'Ask question' })).toHaveProperty(
    'disabled',
    true,
  );
});
it('renders model insufficiency without presenting uncited facts', async () => {
  requests({
    ...supported,
    status: 'INSUFFICIENT_EVIDENCE',
    reason: 'INSUFFICIENT_RETRIEVED_EVIDENCE',
    answer: 'Insufficient evidence',
    citations: [],
    generation: {
      ...supported.generation!,
      result: {
        ...supported.generation!.result,
        answer: { status: 'INSUFFICIENT_EVIDENCE', claims: [] },
      },
    },
  });
  panel();
  await submit();
  expect(
    await screen.findByText('There is insufficient evidence to answer this request.'),
  ).not.toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});
it('clears private question state across workspaces and ignores a late result from the previous workspace', async () => {
  let resolveAnswer!: (value: Response) => void;
  const mock = requests();
  mock.mockImplementation((url: unknown) =>
    String(url).endsWith('/questions')
      ? new Promise<Response>((resolve) => {
          resolveAnswer = resolve;
        })
      : Promise.resolve(
          String(url).endsWith('/sources') ? json([ready]) : json(undefined, 204),
        ),
  );
  const view = panel();
  await submit('Private previous question');
  await waitFor(() =>
    expect(
      mock.mock.calls.filter((c) => String(c[0]).endsWith('/questions')),
    ).toHaveLength(1),
  );
  view.rerender(view.wrap('w2'));
  expect(screen.getByLabelText('Question')).toHaveProperty('value', '');
  await act(async () => resolveAnswer(json(supported)));
  expect(screen.queryByText(supported.answer)).toBeNull();
  expect(screen.queryByText('Question: Private previous question')).toBeNull();
});

function focused(
  focus: { sourceId: string; sheetName: string | null },
  workspaceId = 'w1',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (next: typeof focus) => (
    <QueryClientProvider client={client}>
      <WorkspaceQuestions workspaceId={workspaceId} focus={next} />
    </QueryClientProvider>
  );
  return { ...render(wrap(focus)), wrap };
}
it('starts scoped to the dataset chosen for analysis and asks only about that source', async () => {
  const mock = requests(supported, [
    ready,
    { id: 's2', displayName: 'Other', status: 'READY' },
  ]);
  focused({ sourceId: 's1', sheetName: null });

  const question = screen.getByLabelText('Question') as HTMLTextAreaElement;
  expect(question.value).toBe(
    'Describe the columns, data types and data-quality issues in this dataset.',
  );
  expect(document.activeElement).toBe(question);
  expect((screen.getByLabelText('Selected sources') as HTMLInputElement).checked).toBe(
    true,
  );
  expect(((await screen.findByLabelText('Lecture')) as HTMLInputElement).checked).toBe(
    true,
  );
  expect((screen.getByLabelText('Other') as HTMLInputElement).checked).toBe(false);

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ask question' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
  await screen.findByText(supported.answer);
  const post = mock.mock.calls.find((call) => String(call[0]).endsWith('/questions'));
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    question: 'Describe the columns, data types and data-quality issues in this dataset.',
    selectedSourceIds: ['s1'],
  });
});
it('names the sheet of a workbook, but not the implicit CSV sheet', () => {
  requests();
  const { unmount } = focused({ sourceId: 's1', sheetName: 'Measurements' });
  expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toContain(
    'Focus on the "Measurements" sheet.',
  );
  unmount();
  focused({ sourceId: 's1', sheetName: 'CSV' });
  expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).not.toContain(
    'Focus on',
  );
});
it('starts over when another dataset is chosen in the same workspace', async () => {
  requests();
  const { rerender, wrap } = focused({ sourceId: 's1', sheetName: null });
  fireEvent.change(screen.getByLabelText('Question'), {
    target: { value: 'my own words' },
  });
  rerender(wrap({ sourceId: 's1', sheetName: 'Second' }));
  expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toContain(
    '"Second"',
  );
});
