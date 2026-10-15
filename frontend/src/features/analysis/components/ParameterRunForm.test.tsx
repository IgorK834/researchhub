/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ParameterRunForm } from './ParameterRunForm';
import { ParameterComparison } from './ParameterComparison';
import { parameterRunApi } from '../api/parameterRunApi';
import {
  fetchProblemExecutions,
  type ProblemAnalysis,
  type ProblemExecution,
} from '../api/problemApi';
import { setLocale } from '../../../shared/i18n';
jest.mock('../api/parameterRunApi');
jest.mock('../api/problemApi');
let client: QueryClient;
const analysis: ProblemAnalysis = {
  schemaVersion: '2.0',
  workload: 'PROBLEM',
  id: 'a',
  workspaceId: 'w',
  userPrompt: 'Speed',
  status: 'READY_TO_EXECUTE',
  snapshot: {
    problem: {
      statement: 'Speed',
      parameters: [{ symbol: 'x', value: '2', unit: 'm' }],
      unknowns: [],
      domain: 'REAL',
      expectedOutputs: [],
      assumptions: [],
      plot: { parameter: 'x', start: '0', end: '10', points: 11, output: 'result' },
    },
    inputHash: 'a',
    origin: null,
    templateId: 't',
    templateHash: 'b',
  },
  plan: { summary: 'Plan', warnings: [] },
  audit: null,
  missing: [],
  parentAnalysisId: null,
};
function Location() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(node: React.ReactElement) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {node}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  setLocale('en');
  jest.mocked(parameterRunApi.definitions).mockResolvedValue([
    {
      schemaVersion: '1.0',
      name: 'x',
      type: 'DECIMAL',
      unit: 'm',
      bounds: { minimum: '-10', maximum: '10' },
      defaultValue: '2',
      required: true,
    },
  ]);
  jest.mocked(parameterRunApi.run).mockResolvedValue({
    parentAnalysisId: 'a',
    analysisId: 'child',
    executionId: 'e',
    mode: 'APPROVED_PLAN',
    llmTokens: 0,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});
it('previews typed parameters/units and plot bounds, retaining one identity on network retry', async () => {
  jest
    .mocked(parameterRunApi.run)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({
      parentAnalysisId: 'a',
      analysisId: 'child',
      executionId: 'e',
      mode: 'APPROVED_PLAN',
      llmTokens: 0,
    });
  mount(<ParameterRunForm analysis={analysis} />);
  await screen.findByLabelText(/x \(m\)/);
  fireEvent.change(screen.getByLabelText(/x \(m\)/), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Input snapshot'), {
    target: { value: 'LATEST' },
  });
  fireEvent.change(screen.getByLabelText('Plot start'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Plot end'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Plot points'), { target: { value: '9' } });
  expect(screen.getByText('x: 2 → 3 m')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Run approved plan' }));
  await screen.findByRole('alert');
  const first = jest.mocked(parameterRunApi.run).mock.calls[0]![2];
  expect(first.parameters).toEqual({ x: { type: 'DECIMAL', value: '3', unit: 'm' } });
  expect(first.plot?.points).toBe(9);
  fireEvent.click(screen.getByRole('button', { name: 'Run approved plan' }));
  await screen.findByText('/app/workspaces/w/analyses/child?execution=e');
  expect(jest.mocked(parameterRunApi.run).mock.calls[1]![2].idempotencyKey).toBe(
    first.idempotencyKey,
  );
});
it('supports a problem without plot and default parameters', async () => {
  mount(
    <ParameterRunForm
      analysis={{
        ...analysis,
        snapshot: {
          ...analysis.snapshot,
          problem: { ...analysis.snapshot.problem, plot: null },
        },
      }}
    />,
  );
  await screen.findByRole('button', { name: 'Run approved plan' });
  expect(screen.queryByLabelText('Plot start')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run approved plan' }));
  await waitFor(() => expect(parameterRunApi.run).toHaveBeenCalled());
  expect(jest.mocked(parameterRunApi.run).mock.calls[0]![2]).toMatchObject({
    inputMode: 'ORIGINAL',
    plot: null,
    parameters: { x: { value: '2' } },
  });
});
it('handles definition loading and failure', async () => {
  let reject!: (e: Error) => void;
  jest.mocked(parameterRunApi.definitions).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  mount(<ParameterRunForm analysis={analysis} />);
  expect(screen.getByText('Loading…')).toBeTruthy();
  await act(async () => reject(new Error('forbidden')));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button')).toBeNull();
});
it('compares parent computed output values without overwriting either result', async () => {
  const original = {
    id: 'e',
    status: 'SUCCEEDED',
    result: { outputs: [{ name: 'result', values: [2], unit: 'm' }] },
  } as ProblemExecution;
  const current = {
    ...original,
    result: {
      outputs: [
        { name: 'result', values: [3], unit: 'm' },
        { name: 'extra', values: [4], unit: 'm' },
      ],
    },
  } as ProblemExecution;
  jest.mocked(fetchProblemExecutions).mockResolvedValue([original]);
  mount(
    <ParameterComparison workspaceId="w" parentAnalysisId="parent" current={current} />,
  );
  await screen.findByRole('table');
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText('—')).toBeTruthy();
  expect(original.result!.outputs[0]!.values).toEqual([2]);
});
it('handles missing and forbidden comparison inputs', async () => {
  jest.mocked(fetchProblemExecutions).mockResolvedValue([]);
  mount(
    <ParameterComparison
      workspaceId="w"
      parentAnalysisId="parent"
      current={{ result: null } as ProblemExecution}
    />,
  );
  await screen.findByText('No completed original result available.');
  jest.mocked(fetchProblemExecutions).mockRejectedValue(new Error('revoked'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['parameter-comparison'] });
  });
  await screen.findByRole('alert');
  expect(screen.queryByRole('table')).toBeNull();
});
