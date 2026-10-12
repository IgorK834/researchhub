/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SolutionView, StepDetailsLink } from './SolutionView';
import { ProvenanceProvider } from '../../documents/provenance/ProvenancePanel';
import { ProblemReferencedOutput } from '../../documents/components/ProblemReferencedOutput';
import { AnalysisOutputPicker } from './AnalysisOutputPicker';
import * as api from '../api/solutionApi';
import * as datasets from '../api/analysisApi';
import * as problems from '../api/problemApi';
import fixture from '../../../../../contracts/analysis/execution/v3/solution.json';
import type { AnalysisReference } from '../../documents/api/analysisReference';
const bundle = fixture as unknown as api.SolutionBundle;
const ref: AnalysisReference = {
  schemaVersion: '2.0',
  workload: 'PROBLEM',
  analysisId: bundle.analysisId,
  executionId: bundle.executionId,
  outputId: 'solution',
  renderMode: 'SOLUTION',
  stepId: null,
  conversationId: null,
};
const plot = {
  parameter: 'distance',
  output: 'result',
  xUnit: 'm',
  yUnit: 'm/s',
  points: [
    [0, 0],
    [1, 0.5],
  ],
};
function mount(child: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      }
    >
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
test('saved formulas, substitutions, tolerances and unchecked interpretation remain separate', () => {
  const view = render(<SolutionView bundle={bundle} />);
  expect(screen.getByText('result: 0.5 m/s')).toBeTruthy();
  expect(screen.getByText(/Absolute tolerance/)).toBeTruthy();
  fireEvent.click(screen.getByText('Saved steps and verification'));
  expect(screen.getByText('Step result: 0.5 m/s')).toBeTruthy();
  expect(screen.getByText('distance = 100 cm · SI: 1')).toBeTruthy();
  expect(document.querySelector('[role=math]')).toBeTruthy();
  view.rerender(<SolutionView bundle={bundle} mode="INPUTS" />);
  expect(screen.getByText('Domain: REAL')).toBeTruthy();
  view.rerender(
    <SolutionView
      bundle={{ ...bundle, unknowns: [{ symbol: 'x', unit: 'm' }] }}
      mode="INPUTS"
    />,
  );
  expect(screen.getByText('Unknown: x (m)')).toBeTruthy();
  view.rerender(
    <SolutionView
      bundle={{
        ...bundle,
        interpretation: {
          ...bundle.interpretation,
          warnings: ['Human interpretation only'],
        },
      }}
      mode="ASSUMPTIONS"
    />,
  );
  expect(screen.getByText('Interpretation: NOT_CHECKED')).toBeTruthy();
  expect(screen.getByText('Human interpretation only')).toBeTruthy();
  view.rerender(
    <SolutionView bundle={bundle} mode="STEP" stepId={bundle.steps[0]!.id} />,
  );
  expect(screen.getByText(/Arithmetic: CHECKED/)).toBeTruthy();
  view.rerender(<SolutionView bundle={bundle} mode="STEP" stepId="absent" />);
  expect(screen.getByRole('alert')).toBeTruthy();
  view.rerender(
    <SolutionView
      bundle={{
        ...bundle,
        steps: [{ ...bundle.steps[0]!, expression: { op: 'script' } as never }],
      }}
      mode="STEP"
      stepId={bundle.steps[0]!.id}
    />,
  );
  expect(screen.getByText('Formula unavailable')).toBeTruthy();
});
test('exact execution and step links never choose latest', () => {
  mount(<StepDetailsLink workspaceId="w" bundle={bundle} stepId={bundle.steps[0]!.id} />);
  expect(screen.getByRole('link').getAttribute('href')).toContain(
    `execution=${bundle.executionId}#step-${bundle.steps[0]!.id}`,
  );
});
test('referenced solution loads saved values and explicit update, with safe human caption', async () => {
  jest.spyOn(api, 'fetchSolution').mockResolvedValue(bundle);
  const update = jest.fn();
  mount(
    <ProblemReferencedOutput
      workspaceId="w"
      reference={{ ...ref, conversationId: 'chat' }}
      caption="<script>caption</script>"
      canEdit
      onUpdate={update}
    />,
  );
  expect(screen.getByRole('status')).toBeTruthy();
  await screen.findByText('result: 0.5 m/s');
  expect(document.querySelector('script')).toBeNull();
  expect(
    screen.getByText('Human caption (not verified): <script>caption</script>'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Update reference' }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(
    screen
      .getByRole('link', { name: 'Open originating conversation' })
      .getAttribute('href'),
  ).toContain('conversation=chat');
});
test.each(['TABLE', 'CHART'] as const)(
  'numeric table/chart read immutable points and same-origin artifact (%s)',
  async (mode) => {
    jest.spyOn(api, 'fetchSolution').mockResolvedValue({ ...bundle, plot });
    mount(
      <ProblemReferencedOutput
        workspaceId="w /"
        reference={{
          ...ref,
          renderMode: mode,
          outputId: mode === 'TABLE' ? 'plot-data' : 'plot',
        }}
        caption=""
      />,
    );
    if (mode === 'TABLE') {
      await screen.findByRole('table');
      expect(screen.getByText('0.5')).toBeTruthy();
    } else {
      const image = await screen.findByRole('img');
      expect(image.getAttribute('src')).toContain('/api/workspaces/w%20%2F/');
      expect(image.getAttribute('src')).toContain(bundle.executionId);
    }
  },
);
test('unavailable capability shows an error without substituting another execution', async () => {
  jest.spyOn(api, 'fetchSolution').mockRejectedValue(new Error('Missing capability'));
  mount(<ProblemReferencedOutput workspaceId="w" reference={ref} caption="" />);
  await screen.findByRole('alert');
  expect(screen.queryByText('result: 0.5 m/s')).toBeNull();
});
test('saved output picker explicitly chooses PROBLEM solution, table and chart', async () => {
  jest
    .spyOn(datasets, 'fetchAnalyses')
    .mockResolvedValue([
      { id: bundle.analysisId, userPrompt: 'Speed', workload: 'PROBLEM' },
    ] as never);
  jest.spyOn(problems, 'fetchProblemExecutions').mockResolvedValue([
    { id: bundle.executionId, status: 'SUCCEEDED', completedAt: '2026-10-11T00:00:00Z' },
    { id: 'failed', status: 'FAILED' },
  ] as never);
  jest.spyOn(api, 'fetchSolution').mockResolvedValue({ ...bundle, plot });
  const choose = jest.fn();
  mount(<AnalysisOutputPicker workspaceId="w" onChoose={choose} />);
  await screen.findByRole('option', { name: 'Speed' });
  fireEvent.change(screen.getByLabelText('Analysis'), {
    target: { value: bundle.analysisId },
  });
  await screen.findByRole('option', { name: /Saved run/ });
  fireEvent.change(screen.getByLabelText('Execution'), {
    target: { value: bundle.executionId },
  });
  await screen.findByRole('option', { name: 'solution (SOLUTION)' });
  for (const [output, mode] of [
    ['solution', 'SOLUTION'],
    ['plot-data', 'TABLE'],
    ['plot', 'CHART'],
  ]) {
    fireEvent.change(screen.getByLabelText('Output'), { target: { value: output } });
    fireEvent.click(screen.getByRole('button', { name: 'Use selected output' }));
    expect(choose).toHaveBeenLastCalledWith({
      ...ref,
      outputId: output,
      renderMode: mode,
    });
  }
  expect(screen.queryByRole('option', { name: /failed/ })).toBeNull();
  await waitFor(() => expect(api.fetchSolution).toHaveBeenCalledTimes(1));
});

test.each([false, true])(
  'opens saved scientific provenance from a block (shared panel: %s)',
  async (shared) => {
    jest.spyOn(api, 'fetchSolution').mockResolvedValue(bundle);
    const block = (
      <ProblemReferencedOutput workspaceId="w" reference={ref} caption="Saved solution" />
    );
    mount(shared ? <ProvenanceProvider>{block}</ProvenanceProvider> : block);
    fireEvent.click(screen.getByRole('button', { name: 'Show provenance' }));
    const panel = await screen.findByRole('dialog', { name: 'Provenance' });
    expect(panel).toBeTruthy();
    expect(await screen.findByText('Scientific analysis provenance')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);
