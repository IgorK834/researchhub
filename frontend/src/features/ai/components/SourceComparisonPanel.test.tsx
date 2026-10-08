/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SourceComparisonPanel,
  ComparisonResult,
  DisagreementResult,
} from './SourceComparisonPanel';
import {
  compareSources,
  findPotentialDisagreements,
  DEFAULT_COMPARISON_CRITERIA,
  type SourceAnalysis,
} from '../api/sourceAnalysisApi';
import type { Citation } from '../api/generationApi';
let mockSources: {
  data?: {
    id: string;
    displayName: string;
    status: 'READY' | 'PROCESSING';
    activeVersionId?: string;
  }[];
  error: Error | null;
  isPending: boolean;
};
jest.mock('../../sources/api/useSources', () => ({ useSourcesQuery: () => mockSources }));
jest.mock('../api/sourceAnalysisApi', () => ({
  ...jest.requireActual('../api/sourceAnalysisApi'),
  compareSources: jest.fn(),
  findPotentialDisagreements: jest.fn(),
}));
const compare = jest.mocked(compareSources),
  differences = jest.mocked(findPotentialDisagreements);
const c: Citation = {
  sourceId: 's1',
  workspaceId: 'w',
  sourceVersionId: null,
  chunkId: 'a'.repeat(64),
  contentHash: 'b'.repeat(64),
  processingVersion: 'v1',
  pageStart: 7,
  pageEnd: 7,
  sectionTitle: null,
  title: 'Paper A',
  spans: [{ unitId: 'p7', characterStart: 0, characterEnd: 20 }],
};
const comparison: SourceAnalysis = {
  analysisInstruction: 'Compare sources',
  id: 'comparison',
  workspaceId: 'w',
  kind: 'COMPARISON',
  parentComparisonId: null,
  command: {
    selectedSourceIds: ['s1', 's2'],
    criteria: ['method', 'dataset'],
    instruction: null,
  },
  sources: [
    {
      id: 's1',
      title: 'Paper A',
      sourceVersionId: 'v-a1',
      versionNumber: 1,
      contentSha256: 'a'.repeat(64),
    },
    {
      id: 's2',
      title: 'Paper B',
      sourceVersionId: 'v-b1',
      versionNumber: 1,
      contentSha256: 'b'.repeat(64),
    },
  ],
  answer: {
    status: 'READY',
    rows: [
      {
        sourceId: 's1',
        cells: [
          {
            criterion: 'method',
            status: 'REPORTED',
            text: '<script>Randomized</script>',
            evidenceIds: [c.chunkId],
          },
        ],
      },
      { sourceId: 's2', cells: [] },
    ],
    summary: [{ text: 'Cited narrative', evidenceIds: [c.chunkId] }],
    findings: [],
  },
  evidence: [
    c,
    {
      ...c,
      sourceId: 's2',
      chunkId: 'b'.repeat(64),
      title: 'Paper B',
      pageStart: null,
      pageEnd: null,
      sectionTitle: 'Method',
    },
  ],
  warnings: ['AI-assisted interpretation; review cited excerpts.'],
  generation: {
    requestId: 'g',
    templateId: 'source-comparison:1',
    model: {
      name: 'fixture',
      version: '1',
      provider: 'deterministic',
      structuredOutput: true,
      streaming: false,
    },
  },
  createdAt: 'now',
};
const disagreement: SourceAnalysis = {
  ...comparison,
  id: 'differences',
  kind: 'DISAGREEMENTS',
  parentComparisonId: 'comparison',
  answer: {
    status: 'READY',
    rows: [],
    summary: [],
    findings: [
      {
        category: 'POTENTIAL_DISAGREEMENT',
        description: 'Review conditions',
        sides: [
          { sourceId: 's1', text: 'First result', evidenceIds: [c.chunkId] },
          { sourceId: 's2', text: 'Second result', evidenceIds: ['b'.repeat(64)] },
        ],
        methodologicalContext: {
          criterion: 'method',
          status: 'REPORTED',
          text: 'Different populations',
          evidenceIds: [c.chunkId],
        },
      },
      {
        category: 'DIFFERENT_REPORTED_RESULT',
        description: 'Context missing',
        sides: [
          { sourceId: 's1', text: 'A', evidenceIds: [c.chunkId] },
          { sourceId: 's2', text: 'B', evidenceIds: ['b'.repeat(64)] },
        ],
        methodologicalContext: {
          criterion: 'method',
          status: 'MISSING',
          text: null,
          evidenceIds: [],
        },
      },
      {
        category: 'DIFFERENT_EXPERIMENTAL_CONDITIONS',
        description: 'Different samples',
        sides: [
          { sourceId: 's1', text: 'A', evidenceIds: [c.chunkId] },
          { sourceId: 's2', text: 'B', evidenceIds: ['b'.repeat(64)] },
        ],
        methodologicalContext: {
          criterion: 'method',
          status: 'MISSING',
          text: null,
          evidenceIds: [],
        },
      },
    ],
  },
};

test.each([
  ['deterministic', 'Fixture AI (deterministic)'],
  ['live', 'Live model: recorded-model'],
])('historical comparison identifies its %s provider', (provider, label) => {
  render(
    <MemoryRouter>
      <ComparisonResult
        analysis={{
          ...comparison,
          generation: {
            ...comparison.generation!,
            model: { ...comparison.generation!.model, provider, name: 'recorded-model' },
          },
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(label)).toBeTruthy();
});
function view(id = 'w') {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <SourceComparisonPanel workspaceId={id} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function choose() {
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  fireEvent.click(screen.getByLabelText('Paper A'));
  fireEvent.click(screen.getByLabelText('Paper B'));
}
beforeEach(() => {
  jest.resetAllMocks();
  mockSources = {
    data: [
      { id: 's1', displayName: 'Paper A', status: 'READY', activeVersionId: 'v-a1' },
      { id: 's2', displayName: 'Paper B', status: 'READY', activeVersionId: 'v-b1' },
    ],
    error: null,
    isPending: false,
  };
  compare.mockResolvedValue(comparison);
  differences.mockResolvedValue(disagreement);
});
afterEach(cleanup);
test('comparison and baseline-scoped differences show table, narrative and both citations before any writing', async () => {
  const { container } = render(view());
  choose();
  fireEvent.change(screen.getByLabelText('Comparison instruction (optional)'), {
    target: { value: 'Compare results' },
  });
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByRole('table');
  expect(compare).toHaveBeenCalledWith('w', {
    selectedSourceIds: ['s1', 's2'],
    criteria: [...DEFAULT_COMPARISON_CRITERIA],
    instruction: 'Compare results',
  });
  expect(screen.getByText('Cited narrative')).toBeTruthy();
  expect(screen.getAllByText('Missing in retrieved excerpts')).toHaveLength(3);
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getAllByRole('link')[0]?.getAttribute('href')).toContain(
    'sources/s1?processingVersion=v1&unit=p7&page=7',
  );
  fireEvent.change(screen.getByLabelText('Disagreement analysis focus (optional)'), {
    target: { value: 'Datasets' },
  });
  fireEvent.click(screen.getByText('Find potential disagreements'));
  await screen.findByText('Potential disagreement');
  expect(differences).toHaveBeenCalledWith('w', 'comparison', 'Datasets', 'ORIGINAL');
  expect(screen.getByText('Different reported result')).toBeTruthy();
  expect(screen.getByText('Different experimental conditions')).toBeTruthy();
  expect(screen.getByText('First result')).toBeTruthy();
  expect(screen.getByText('Second result')).toBeTruthy();
  expect(screen.getAllByText(/Unavailable in retrieved excerpts/)).toHaveLength(2);
  expect(
    screen
      .getAllByRole('link')
      .some((link) => link.getAttribute('href')?.includes('sources/s2')),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  fireEvent.click(screen.getByLabelText('Paper A'));
  fireEvent.click(screen.getByLabelText('Paper A'));
  fireEvent.change(screen.getByLabelText('Comparison criteria (one per line)'), {
    target: { value: 'custom' },
  });
  fireEvent.change(screen.getByLabelText('Comparison instruction (optional)'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByText('Compare selected sources'));
  await waitFor(() => expect(compare).toHaveBeenCalledTimes(2));
  expect(compare).toHaveBeenLastCalledWith('w', {
    selectedSourceIds: ['s2', 's1'],
    criteria: ['custom'],
    instruction: null,
  });
  expect(screen.queryByLabelText('Potential disagreement result')).toBeNull();
});
test('invalid selections and criteria stop calls, including excessive source counts', () => {
  mockSources.data = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`,
    displayName: `Paper ${i}`,
    status: 'READY',
  }));
  render(view());
  fireEvent.click(screen.getByText('Compare selected sources'));
  expect(screen.getByRole('alert').textContent).toContain('Select 2–5');
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByLabelText(`Paper ${i}`));
  expect(screen.getByLabelText('Paper 5')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Add source' })).toHaveProperty(
    'disabled',
    true,
  );
  for (let i = 2; i < 5; i++) fireEvent.click(screen.getByLabelText(`Paper ${i}`));
  for (const criteria of ['', 'method\nMETHOD', 'a\nb\nc\nd\ne\nf', 'x'.repeat(65)]) {
    fireEvent.change(screen.getByLabelText('Comparison criteria (one per line)'), {
      target: { value: criteria },
    });
    fireEvent.click(screen.getByText('Compare selected sources'));
    expect(screen.getByRole('alert').textContent).toContain('distinct criteria');
  }
  expect(compare).not.toHaveBeenCalled();
});
test('loading, failed source list and no sources are explicit', () => {
  mockSources = { isPending: true, error: null };
  const { rerender } = render(view());
  expect(screen.getByRole('status').textContent).toContain('Loading comparison');
  mockSources = { isPending: false, error: new Error('Network') };
  rerender(view());
  expect(screen.getByRole('alert').textContent).toContain('Could not load');
  mockSources = { isPending: false, error: null, data: [] };
  rerender(view());
  expect(screen.getByText('No sources available for comparison.')).toBeTruthy();
});
test('failed and pending calls keep controls bounded and results are reset on workspace changes', async () => {
  let resolve!: (value: SourceAnalysis) => void;
  compare.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { rerender } = render(view());
  choose();
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByText('Comparing…');
  expect(
    (
      screen.getByLabelText('Comparison instruction (optional)') as HTMLTextAreaElement
    ).closest('fieldset')?.disabled,
  ).toBe(true);
  resolve(comparison);
  await screen.findByRole('table');
  differences.mockRejectedValue(new Error('Unavailable'));
  fireEvent.click(screen.getByText('Find potential disagreements'));
  await screen.findByText(/Disagreement analysis failed/);
  expect(differences).toHaveBeenCalledWith('w', 'comparison', null, 'ORIGINAL');
  compare.mockRejectedValue(new Error('Unavailable'));
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByText(/Comparison failed/);
  rerender(view('another'));
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  expect((screen.getByLabelText('Paper A') as HTMLInputElement).checked).toBe(false);
});
test('no-evidence, no differences and unavailable reference states do not invent agreement', () => {
  render(
    <MemoryRouter>
      <ComparisonResult
        analysis={{
          ...comparison,
          generation: null,
          answer: {
            ...comparison.answer,
            status: 'INSUFFICIENT_EVIDENCE',
            summary: [{ text: 'Unavailable', evidenceIds: ['missing'] }],
          },
        }}
      />
      <DisagreementResult
        analysis={{
          ...disagreement,
          answer: {
            status: 'NO_POTENTIAL_DISAGREEMENT',
            rows: [],
            summary: [],
            findings: [],
          },
        }}
      />
      <DisagreementResult
        analysis={{
          ...disagreement,
          answer: {
            status: 'INSUFFICIENT_EVIDENCE',
            rows: [],
            summary: [],
            findings: [],
          },
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/does not establish agreement/)).toBeTruthy();
  expect(
    screen.getByText('Insufficient evidence from at least two sources.'),
  ).toBeTruthy();
  expect(screen.getByText(/Unavailable reference/)).toBeTruthy();
});

test('column headers name the exact source version each result consumed', async () => {
  render(view());
  choose();
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByRole('table');
  expect(screen.getByText('Paper A (version 1)')).toBeTruthy();
  expect(screen.getByText('Paper B (version 1)')).toBeTruthy();
});
test('a follow-up keeps the original versions by default and migrates only when the user chooses', async () => {
  render(view());
  choose();
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByRole('table');
  // No newer version exists, so there is no migration notice and the original versions are preselected.
  expect(screen.queryByText(/A newer version was uploaded/)).toBeNull();
  expect(
    (
      screen.getByLabelText(
        'Use the original versions from the comparison',
      ) as HTMLInputElement
    ).checked,
  ).toBe(true);

  mockSources = {
    ...mockSources,
    data: [
      { id: 's1', displayName: 'Paper A', status: 'READY', activeVersionId: 'v-a2' },
      { id: 's2', displayName: 'Paper B', status: 'READY', activeVersionId: 'v-b1' },
    ],
  };
  cleanup();
  render(view());
  choose();
  fireEvent.click(screen.getByText('Compare selected sources'));
  await screen.findByRole('table');
  expect(screen.getByRole('status').textContent).toContain(
    'A newer version was uploaded after this comparison: Paper A.',
  );
  fireEvent.click(
    screen.getByLabelText('Use the latest versions (re-reads the sources)'),
  );
  fireEvent.click(screen.getByText('Find potential disagreements'));
  await screen.findByText('Potential disagreement');
  expect(differences).toHaveBeenLastCalledWith('w', 'comparison', null, 'LATEST');
});

test('removable chips reset prior results and bounded picker allows changing the selection', async () => {
  render(view());
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Done choosing sources' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Remove Paper A' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Compare selected sources' }));
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Find potential disagreements' }));
  await screen.findByText('Potential disagreement');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Paper A' }));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByLabelText('Potential disagreement result')).toBeNull();
  expect(screen.getByText('1 of 5 selected · choose at least 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Compare selected sources' }));
  expect(screen.getByRole('alert').textContent).toContain('Select 2–5');
  expect(compare).toHaveBeenCalledTimes(1);
});

test('sources that became unavailable cannot be submitted; chips still identify the missing selection', () => {
  const { rerender } = render(view());
  choose();
  mockSources = {
    ...mockSources,
    data: [{ id: 's1', displayName: 'Paper A', status: 'PROCESSING' }],
  };
  rerender(view());
  expect(screen.getByRole('button', { name: 'Remove unavailable source' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Compare selected sources' }));
  expect(screen.getByRole('alert').textContent).toContain('Select 2–5');
  expect(compare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable source' }));
  expect(screen.queryByRole('button', { name: 'Remove unavailable source' })).toBeNull();
});

test('synchronous duplicate form submissions produce one request and disable source editing', async () => {
  let resolve!: (value: SourceAnalysis) => void;
  compare.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(view());
  choose();
  const button = screen.getByRole('button', { name: 'Compare selected sources' });
  const form = button.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByText('Comparing…');
  expect(compare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Remove Paper A' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Add source' })).toHaveProperty(
    'disabled',
    true,
  );
  resolve(comparison);
  await screen.findByRole('table');
  let finish!: (value: SourceAnalysis) => void;
  differences.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const differencesForm = screen
    .getByRole('button', { name: 'Find potential disagreements' })
    .closest('form')!;
  fireEvent.submit(differencesForm);
  fireEvent.submit(differencesForm);
  await screen.findByText('Checking potential disagreements…');
  expect(differences).toHaveBeenCalledTimes(1);
  finish(disagreement);
  await screen.findByText('Potential disagreement');
});

test('missing cells ignore any supplied placeholder text and citations name only returned locations', () => {
  render(
    <MemoryRouter>
      <ComparisonResult
        analysis={{
          ...comparison,
          sources: comparison.sources.map((source) => ({
            ...source,
            sourceVersionId: null,
            versionNumber: 0,
          })),
          answer: {
            ...comparison.answer,
            summary: [],
            rows: [
              {
                sourceId: 's1',
                cells: [
                  {
                    criterion: 'method',
                    status: 'MISSING',
                    text: 'Never fill this field',
                    evidenceIds: [],
                  },
                  {
                    criterion: 'dataset',
                    status: 'REPORTED',
                    text: null,
                    evidenceIds: [],
                  },
                ],
              },
            ],
          },
          evidence: [],
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getAllByText('Missing in retrieved excerpts')).toHaveLength(4);
  expect(screen.queryByText('Never fill this field')).toBeNull();
  expect(screen.getByText('No supported summary was returned.')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Comparison grid' })).toHaveProperty(
    'tabIndex',
    0,
  );
});
