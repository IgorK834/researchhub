/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AiDebugger } from './AiDebugger';
import { loadOverview, loadTrace, type Detail, type Overview } from './devtoolsApi';

jest.mock('./devtoolsApi', () => ({ loadOverview: jest.fn(), loadTrace: jest.fn() }));
const overviewMock = jest.mocked(loadOverview),
  traceMock = jest.mocked(loadTrace);
const citation = {
  chunkId: 'a'.repeat(64),
  workspaceId: 'w1',
  sourceId: 's1',
  sourceVersionId: 'v1',
  processingVersion: 'retrieval:1',
  contentHash: 'b'.repeat(64),
  pageStart: 2,
  pageEnd: 2,
  sectionTitle: 'Methods',
  title: 'Lecture notes',
  spans: [{ unitId: 'p2', characterStart: 0, characterEnd: 8 }],
};
const summary = {
  id: 't1',
  correlationId: 'browser-request',
  startedAt: '2026-10-07T10:00:00Z',
  status: 'SUPPORTED',
  errorCode: null,
  generationRequestId: 'g1',
  query: 'What does the evidence show?',
  retrievedChunks: 1,
};
const context = {
  builderVersion: '1.0' as const,
  tokenPolicy: 'utf8-conservative-v1' as const,
  budget: { maxTokens: 32000, maxBytes: 24000, collapseExactDuplicates: true },
  contextHash: 'c'.repeat(64),
  contextBytes: 2340,
  tokenUpperBound: 5460,
  citations: [{ citationKey: 'S1', chunkId: citation.chunkId, textReference: null }],
};
const usage = {
  requestId: 'g1',
  correlationId: 'browser-request',
  feature: 'ASK_WORKSPACE' as const,
  model: {
    provider: 'fixture',
    name: 'extractive',
    version: '1',
    structuredOutput: true as const,
    streaming: false as const,
  },
  templateId: 'workspace-question:2',
  templateHash: 'd'.repeat(64),
  usage: { inputTokens: 220, outputTokens: 52, totalTokens: 272, estimated: true },
  latencyMs: 150,
  cost: { usd: 0.0012, pricingVersion: 'test-v1', estimated: true },
  status: 'SUCCEEDED',
  errorCode: null,
};
const hit = {
  citation,
  score: 0.7,
  vectorSimilarity: 0.8,
  lexicalScore: 0.2,
  contentBytes: 220,
  embeddingModel: { provider: 'fixture', name: 'embedding', version: '1' },
};
function detail(): Detail {
  return {
    trace: {
      ...summary,
      workspaceId: 'w1',
      selectedSourceIds: null,
      selectedAnalysisOutputs: [],
      topK: 6,
      parameters: { temperature: 0, maxOutputTokens: 1024 },
      templateId: usage.templateId,
      templateHash: usage.templateHash,
      retrievalLatencyMs: 12,
      context,
      response: {
        status: 'SUPPORTED',
        reason: null,
        answer: 'A cited claim.',
        citations: [citation],
        generation: {
          result: {
            schemaVersion: '1.0',
            requestId: 'g1',
            templateId: usage.templateId,
            templateHash: usage.templateHash,
            model: usage.model,
            usage: usage.usage,
            providerRequestId: 'provider1',
            answer: {
              status: 'SUPPORTED',
              claims: [{ text: 'A cited claim.', evidenceIds: [citation.chunkId] }],
            },
          },
          evidence: [citation],
          context,
        },
      },
    },
    usage,
    chunks: [
      {
        hit,
        text: 'Authorized source excerpt.',
        availability: 'AVAILABLE',
        citationKey: 'S1',
        textReference: null,
      },
    ],
    retrievalStrategy: 'hybrid-vector-lexical',
    reranking: 'NOT_APPLICABLE',
  };
}
function overview(): Overview {
  return {
    days: 30,
    contentCaptureEnabled: true,
    traces: [summary],
    usage: [
      {
        feature: 'ASK_WORKSPACE',
        provider: 'fixture',
        model: 'extractive',
        modelVersion: '1',
        templateId: 'workspace-question:2',
        status: 'SUCCEEDED',
        requests: 3,
        usageKnown: 3,
        estimatedUsageRequests: 3,
        inputTokens: 660,
        outputTokens: 156,
        costKnown: 3,
        estimatedCostUsd: 0.0036,
        averageLatencyMs: 150,
      },
      {
        feature: 'SECTION_GENERATION',
        provider: null,
        model: null,
        modelVersion: null,
        templateId: 'authoring-draft:1',
        status: 'FAILED',
        requests: 1,
        usageKnown: 0,
        estimatedUsageRequests: 0,
        inputTokens: null,
        outputTokens: null,
        costKnown: 0,
        estimatedCostUsd: null,
        averageLatencyMs: 2,
      },
    ],
  };
}
function mount(path = '/app/workspaces/w1/devtools/ai'): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/app/workspaces/:workspaceId/devtools/ai"
            element={<AiDebugger />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  jest.resetAllMocks();
  overviewMock.mockResolvedValue(overview());
  traceMock.mockResolvedValue(detail());
});
afterEach(cleanup);
test('operator sees feature/model comparison, request diagnostics, evidence scores and final citations', async () => {
  mount();
  await screen.findByText('Authorized source excerpt.');
  expect(screen.getByText('Ask Workspace')).toBeTruthy();
  expect(screen.getByText('Section generation')).toBeTruthy();
  expect(screen.getByText('A cited claim.')).toBeTruthy();
  expect(screen.getByText('What does the evidence show?')).toBeTruthy();
  expect(screen.getByText('0.7000')).toBeTruthy();
  expect(screen.getByText('5,460')).toBeTruthy();
  expect(screen.getByText('Rate version: test-v1')).toBeTruthy();
  expect(screen.getByText('Lecture notes').closest('a')?.getAttribute('href')).toContain(
    '/sources/s1',
  );
  fireEvent.click(screen.getByText('Final structured citations (1)'));
  expect(screen.getByText(/"pageStart": 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(2));
  expect(traceMock).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText('Usage window'), { target: { value: '7' } });
  await waitFor(() =>
    expect(overviewMock).toHaveBeenLastCalledWith('w1', 7, expect.any(AbortSignal)),
  );
});
test('selects a trace and preserves source filters, shared context, missing text and computed citations', async () => {
  const data = detail();
  traceMock.mockResolvedValue({
    ...data,
    trace: {
      ...data.trace,
      selectedSourceIds: ['s1'],
      selectedAnalysisOutputs: [{ analysisId: 'a1', executionId: 'e1', outputId: 'o1' }],
      parameters: { temperature: null, maxOutputTokens: 1024 },
      response: {
        ...data.trace.response!,
        generation: {
          ...data.trace.response!.generation!,
          evidence: [{ ...citation, title: null }],
          result: {
            ...data.trace.response!.generation!.result,
            answer: {
              status: 'SUPPORTED',
              claims: [{ text: 'Computed claim.', evidenceIds: ['computed-id'] }],
            },
          },
        },
        analysisCitations: [],
      },
    },
    usage: { ...usage, usage: { ...usage.usage, estimated: false }, cost: null },
    chunks: [
      {
        hit: { ...hit, citation: { ...citation, pageEnd: 3 } },
        text: null,
        availability: 'SOURCE_UNAVAILABLE',
        citationKey: 'S2',
        textReference: 'S1',
      },
      {
        hit: {
          ...hit,
          citation: {
            ...citation,
            chunkId: 'other',
            sectionTitle: null,
            pageStart: null,
            pageEnd: null,
            sourceVersionId: null,
          },
        },
        text: null,
        availability: 'CONTENT_CAPTURE_DISABLED',
        citationKey: null,
        textReference: null,
      },
    ],
  });
  overviewMock.mockResolvedValue({
    ...overview(),
    traces: [summary, { ...summary, id: 't2', status: 'FAILED' }],
  });
  mount();
  await screen.findByText('Computed claim.');
  expect(screen.getByText('Provider default')).toBeTruthy();
  expect(screen.getByText('This source version is no longer available.')).toBeTruthy();
  expect(screen.getByText('Retrieved text capture is disabled.')).toBeTruthy();
  expect(screen.getByText('Not in context')).toBeTruthy();
  expect(screen.getByText('computed-id')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('RAG request'), { target: { value: 't2' } });
  await waitFor(() =>
    expect(traceMock).toHaveBeenLastCalledWith('w1', 't2', expect.any(AbortSignal)),
  );
});
test('weak answers expose reason and no-source diagnostics without inventing model tokens', async () => {
  const data = detail();
  traceMock.mockResolvedValue({
    ...data,
    trace: {
      ...data.trace,
      status: 'INSUFFICIENT_EVIDENCE',
      selectedSourceIds: [],
      generationRequestId: null,
      query: null,
      retrievalLatencyMs: null,
      context: null,
      response: {
        status: 'INSUFFICIENT_EVIDENCE',
        reason: 'NO_RETRIEVED_EVIDENCE',
        answer: 'No evidence is available.',
        citations: [],
        generation: null,
      },
    },
    chunks: [],
    usage: null,
  });
  mount();
  await screen.findByText('No evidence is available.');
  expect(screen.getByText('No sources selected')).toBeTruthy();
  expect(screen.getByText('Private query was not captured.')).toBeTruthy();
  expect(screen.getByText(/No chunks retrieved/)).toBeTruthy();
  expect(screen.getByText('NO_RETRIEVED_EVIDENCE')).toBeTruthy();
});
test('failed calls show safe errors and completed stages without an answer', async () => {
  const data = detail();
  traceMock.mockResolvedValue({
    ...data,
    trace: {
      ...data.trace,
      status: 'FAILED',
      errorCode: 'AI_UNAVAILABLE',
      response: null,
    },
    usage: { ...usage, model: null, usage: null, cost: null, status: 'FAILED' },
  });
  mount('/app/workspaces/w1/devtools/ai?trace=t1');
  await screen.findByText(/AI_UNAVAILABLE. Inspect/);
  expect(screen.getByText('No validated answer was produced.')).toBeTruthy();
  expect(screen.getByText('Authorized source excerpt.')).toBeTruthy();
});
test('content-disabled successful requests remain metadata only', async () => {
  const data = detail();
  overviewMock.mockResolvedValue({ ...overview(), contentCaptureEnabled: false });
  traceMock.mockResolvedValue({
    ...data,
    trace: { ...data.trace, response: null },
    usage: null,
  });
  mount();
  await screen.findByText('Private answer was not captured.');
  expect(screen.getByText(/Private content capture disabled/)).toBeTruthy();
});
test('empty state guides the first question and does not fetch a nonexistent trace', async () => {
  overviewMock.mockResolvedValue({
    days: 30,
    contentCaptureEnabled: false,
    usage: [],
    traces: [],
  });
  mount();
  await screen.findByText('No RAG requests yet');
  expect(screen.getByText('No model calls in this window.')).toBeTruthy();
  expect(traceMock).not.toHaveBeenCalled();
});
test('denied overview protects content and detail failures are recoverable', async () => {
  overviewMock.mockRejectedValue(new Error('Denied'));
  mount();
  await screen.findByText('Diagnostics unavailable');
  expect(traceMock).not.toHaveBeenCalled();
  cleanup();
  overviewMock.mockResolvedValue(overview());
  traceMock.mockRejectedValue(new Error('Deleted'));
  mount();
  await screen.findByText(
    'This request is unavailable. Refresh or select another request.',
  );
  expect(screen.queryByText('Authorized source excerpt.')).toBeNull();
});
test('loading states remain visible until each protected request completes', async () => {
  let resolveOverview!: (value: Overview) => void, resolveTrace!: (value: Detail) => void;
  overviewMock.mockReturnValue(
    new Promise((resolve) => {
      resolveOverview = resolve;
    }),
  );
  traceMock.mockReturnValue(
    new Promise((resolve) => {
      resolveTrace = resolve;
    }),
  );
  mount();
  expect(screen.getByText('Loading protected diagnostics…')).toBeTruthy();
  await act(async () => resolveOverview(overview()));
  await screen.findByText('Loading request…');
  await act(async () => resolveTrace(detail()));
  await screen.findByText('Authorized source excerpt.');
});
