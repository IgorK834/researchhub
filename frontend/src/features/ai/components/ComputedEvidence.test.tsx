/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GroundedAnswer } from './GroundedAnswer';
import { WorkspaceQuestions } from './WorkspaceQuestions';
import {
  computedCitation,
  semanticRecord,
  semanticAnalysis,
  analysisId,
  executionId,
} from '../../analysis/testing/semanticFixtures';
import type { GeneratedResponse } from '../api/generationApi';
import type { QuestionResponse } from '../api/questionApi';
import * as questionApi from '../api/questionApi';
import * as sources from '../../sources/api/sourceApi';
import * as analysisApi from '../../analysis/api/analysisApi';
import fixture from '../../../../../contracts/ai/questions/v1/response.json';
import { desktopMedia } from '../../../shared/testing/desktopMedia';
const old = fixture as QuestionResponse;
const citation = computedCitation();
const generation: GeneratedResponse = {
  ...old.generation!,
  analysisEvidence: [citation],
  context: old.generation!.context
    ? {
        ...old.generation!.context,
        builderVersion: '2.0',
        citations: [
          ...old.generation!.context.citations,
          { citationKey: 'A1', chunkId: citation.evidenceId, textReference: null },
        ],
      }
    : undefined,
  result: {
    ...old.generation!.result,
    answer: {
      status: 'SUPPORTED',
      claims: [
        {
          text: 'Theory predicts the measured behaviour; the saved result is 2000 Ω.',
          evidenceIds: [old.citations[0]!.chunkId, citation.evidenceId],
        },
      ],
    },
  },
};
let client: QueryClient;
let media: ReturnType<typeof desktopMedia>;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  media = desktopMedia();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  client.clear();
  media.restore();
  jest.restoreAllMocks();
});
test('source S1 and computation A1 have distinct navigation and preserve historical source/execution IDs', () => {
  const inspect = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GroundedAnswer
          status="SUPPORTED"
          generation={generation}
          evidence={[{ citation: old.citations[0]!, label: 'S1', sourceType: 'PDF' }]}
          analysisEvidence={[{ ...citation, truncated: true }]}
          onInspect={inspect}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show support for claim 1, S1' }));
  expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ label: 'S1' }));
  expect(
    screen.getByRole('link', { name: 'Inspect citation S1' }).getAttribute('href'),
  ).toContain('page=38');
  expect(
    screen.getByRole('link', { name: 'Open analysis evidence A1' }).getAttribute('href'),
  ).toBe(`/app/workspaces/w/analyses/${analysisId}?execution=${executionId}`);
  expect(screen.getByText(/Only a bounded subset/)).toBeTruthy();
  expect(screen.getByText(/measurements.xlsx · v3/)).toBeTruthy();
});
test('computed evidence remains navigable without the optional context summary and never creates source evidence', () => {
  render(
    <MemoryRouter>
      <GroundedAnswer
        status="SUPPORTED"
        generation={{
          ...generation,
          context: undefined,
          result: {
            ...generation.result,
            answer: {
              status: 'SUPPORTED',
              claims: [
                { text: '2000 Ω from saved output', evidenceIds: [citation.evidenceId] },
              ],
            },
          },
        }}
        evidence={[]}
        analysisEvidence={[citation]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Open analysis evidence A1' })).toBeTruthy();
  expect(screen.getByText(/This answer did not run a new calculation/)).toBeTruthy();
});
test('question submission forwards only explicitly selected saved outputs', async () => {
  jest.spyOn(sources, 'fetchSources').mockResolvedValue([]);
  jest.spyOn(analysisApi, 'fetchAnalyses').mockResolvedValue([semanticAnalysis()]);
  jest
    .spyOn(analysisApi, 'fetchExecutions')
    .mockResolvedValue([semanticRecord().execution]);
  jest.spyOn(analysisApi, 'fetchExecutionRecord').mockResolvedValue(semanticRecord());
  const ask = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceQuestions workspaceId="w" onAsk={ask} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByText('Loading sources for questions…')).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose computed output' }));
  await screen.findByRole('option', { name: 'Calculate impedance versus frequency' });
  fireEvent.change(screen.getByLabelText('Analysis'), { target: { value: analysisId } });
  await screen.findByText(/Attempt 1/);
  fireEvent.change(screen.getByLabelText('Execution'), {
    target: { value: executionId },
  });
  await screen.findByText('impedance-table (TABLE)');
  fireEvent.change(screen.getByLabelText('Output'), {
    target: { value: 'impedance-table' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Use selected output' }));
  fireEvent.change(screen.getByLabelText('Question'), {
    target: { value: 'Does our result agree with theory?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ask question' }));
  expect(ask).toHaveBeenCalledWith({
    question: 'Does our result agree with theory?',
    selectedAnalysisOutputs: [{ analysisId, executionId, outputId: 'impedance-table' }],
  });
});
test('an initial question preserves computation scope and renders its computed response', async () => {
  jest.spyOn(sources, 'fetchSources').mockResolvedValue([]);
  jest
    .spyOn(questionApi, 'askWorkspaceQuestion')
    .mockResolvedValue({ ...old, generation, analysisCitations: [citation] });
  const initial = {
    question: 'Saved experiment?',
    selectedSourceIds: [],
    selectedAnalysisOutputs: [{ analysisId, executionId, outputId: 'impedance-table' }],
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceQuestions workspaceId="w" initialQuestion={initial} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole('link', { name: 'Open analysis evidence A1' }),
  ).toBeTruthy();
  expect(questionApi.askWorkspaceQuestion).toHaveBeenCalledWith('w', initial);
});
