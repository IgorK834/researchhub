/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProblemForm } from './ProblemForm';
import { ProblemStudio } from './ProblemStudio';
import { MathAuthoring } from '../../documents/components/MathAuthoring';
import { Editor } from '@tiptap/core';
import { documentExtensions } from '../../documents/api/documentContent';
import * as api from '../api/problemApi';
import type { ProblemAnalysis, ProblemExecution } from '../api/problemApi';
import fixture from '../../../../../contracts/analysis/computation-plan/v2/problem-create.json';
jest.mock('../api/problemApi');
const a: ProblemAnalysis = {
  schemaVersion: '2.0',
  workload: 'PROBLEM',
  id: 'a',
  workspaceId: 'w',
  userPrompt: 'Calculate speed',
  status: 'DRAFT',
  snapshot: {
    problem: fixture.problem as ProblemAnalysis['snapshot']['problem'],
    inputHash: 'a'.repeat(64),
    origin: null,
    templateId: 'problem-plan:2',
    templateHash: 'b'.repeat(64),
  },
  plan: null,
  audit: null,
  missing: [],
  parentAnalysisId: null,
};
const e: ProblemExecution = {
  id: 'e',
  analysisId: 'a',
  status: 'SUCCEEDED',
  failureCode: null,
  inputHash: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
  imageId: 'sha256:' + 'c'.repeat(64),
  runtimeVersion: '1.2.0',
  result: {
    outputs: [
      {
        name: 'result',
        unit: 'm/s',
        values: [0.5],
        expression: fixture.problem.expectedOutputs[0]!
          .expression as import('../../documents/api/mathAst').MathAst,
        steps: [],
      },
    ],
    plot: {
      points: [
        [0, 0],
        [100, 0.5],
      ],
      xUnit: 'cm',
      yUnit: 'm/s',
    },
  },
  verification: {
    status: 'CHECKED',
    candidateHash: 'd'.repeat(64),
    receipt: { status: 'CHECKED' },
  },
};
function mount(node: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  jest.resetAllMocks();
});
test('problem form saves explicit data without upload and keeps retry identity', async () => {
  const created = jest.fn();
  jest
    .mocked(api.createProblem)
    .mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValue(a);
  mount(<ProblemForm workspaceId="w" onCreated={created} />);
  fireEvent.change(screen.getByLabelText('Problem statement'), {
    target: { value: 'Speed' },
  });
  fireEvent.change(screen.getByLabelText('Problem formula'), {
    target: { value: 'distance / time' },
  });
  fireEvent.change(screen.getByLabelText('Result unit'), { target: { value: 'm/s' } });
  fireEvent.change(screen.getByLabelText('Problem parameters'), {
    target: { value: 'distance;100;cm\ntime;2;s' },
  });
  fireEvent.click(screen.getByLabelText('Use the REAL domain'));
  fireEvent.click(screen.getByLabelText('Generate plot'));
  fireEvent.change(screen.getByLabelText('Plot range'), {
    target: { value: 'distance;0;100;11' },
  });
  fireEvent.change(screen.getByLabelText('Problem assumptions'), {
    target: { value: 'Constant speed.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('a'));
  expect(api.createProblem).toHaveBeenCalledTimes(2);
  expect(jest.mocked(api.createProblem).mock.calls[0]?.[3]).toBe(
    jest.mocked(api.createProblem).mock.calls[1]?.[3],
  );
  expect(jest.mocked(api.createProblem).mock.calls[1]?.[1]).toMatchObject({
    domain: 'REAL',
    parameters: [
      { symbol: 'distance', value: '100', unit: 'cm' },
      { symbol: 'time', value: '2', unit: 's' },
    ],
    plot: { points: 11 },
  });
});
test('missing and invalid inputs, solve mode, lineage and prefill', async () => {
  jest.mocked(api.createProblem).mockResolvedValue(a);
  mount(<ProblemForm workspaceId="w" parent={a} onCreated={jest.fn()} />);
  expect((screen.getByLabelText('Problem parameters') as HTMLTextAreaElement).value).toBe(
    'distance;100;cm\ntime;2;s',
  );
  fireEvent.change(screen.getByLabelText('Problem parameters'), {
    target: { value: 'bad row' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  expect(screen.getByRole('alert').textContent).toContain('Each parameter');
  fireEvent.change(screen.getByLabelText('Problem parameters'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Problem formula'), {
    target: { value: '__import__()' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  expect(api.createProblem).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Calculation'), { target: { value: 'SOLVE' } });
  fireEvent.change(screen.getByLabelText('Unknown'), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText('Problem formula'), {
    target: { value: 'x^2=4' },
  });
  fireEvent.change(screen.getByLabelText('Result unit'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  await waitFor(() => expect(api.createProblem).toHaveBeenCalled());
  expect(jest.mocked(api.createProblem).mock.calls[0]?.[1].unknowns).toEqual([
    { symbol: 'x', unit: '1' },
  ]);
  expect(jest.mocked(api.createProblem).mock.calls[0]?.[2]).toBe(a);
});
test('saved results and reproduction separate checked arithmetic from assumptions', async () => {
  jest.mocked(api.fetchProblem).mockResolvedValue(a);
  jest.mocked(api.fetchProblemExecutions).mockResolvedValue([e]);
  jest.mocked(api.planProblem).mockResolvedValue({
    ...a,
    plan: { summary: 'Plan', warnings: [] },
    status: 'READY_TO_EXECUTE',
  });
  jest.mocked(api.executeProblem).mockResolvedValue(e);
  jest.mocked(api.reproduceProblem).mockResolvedValue(e);
  jest.mocked(api.problemPath).mockReturnValue('/api/problem');
  mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('result: 0.5 m/s');
  expect(screen.getByText(/Computations checked/)).not.toBeNull();
  expect(screen.getByRole('table')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reproduce frozen run' }));
  await waitFor(() => expect(api.reproduceProblem).toHaveBeenCalledWith('w', 'a', 'e'));
  fireEvent.click(screen.getByRole('button', { name: 'Calculate in sandbox' }));
  await waitFor(() => expect(api.executeProblem).toHaveBeenCalled());
  expect(api.planProblem).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Change inputs' }));
  expect(screen.getByRole('form', { name: 'Scientific problem' })).not.toBeNull();
});
test('viewer and clarification disable work; loading and errors remain visible', async () => {
  jest.mocked(api.fetchProblem).mockResolvedValue({
    ...a,
    missing: ['Specify domain.'],
    parentAnalysisId: 'old',
    status: 'WAITING_FOR_INPUT',
  });
  jest.mocked(api.fetchProblemExecutions).mockResolvedValue([
    {
      ...e,
      status: 'FAILED',
      failureCode: 'VERIFICATION_FAILED',
      result: null,
      verification: null,
    },
  ]);
  mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit={false} />);
  await screen.findByText('Clarification required');
  expect(screen.queryByRole('button', { name: 'Calculate in sandbox' })).toBeNull();
  expect((await screen.findByRole('alert')).textContent).toContain('VERIFICATION_FAILED');
  expect(screen.getByRole('link', { name: 'Previous input snapshot' })).not.toBeNull();
});
test('math authoring adds inline/display formulas and keeps validation/cancel safe', () => {
  const editor = new Editor({ extensions: documentExtensions, content: '<p>Text</p>' });
  mount(<MathAuthoring editor={editor} />);
  fireEvent.click(screen.getByRole('button', { name: 'Insert formula' }));
  fireEvent.change(screen.getByLabelText('Formula'), { target: { value: '@hostile' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  expect(screen.getByRole('alert')).not.toBeNull();
  fireEvent.change(screen.getByLabelText('Formula'), { target: { value: '2/3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  expect(JSON.stringify(editor.getJSON())).toContain('inlineMath');
  fireEvent.click(screen.getByRole('button', { name: 'Insert formula' }));
  fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'x^2=4' } });
  fireEvent.click(screen.getByLabelText('Display equation'));
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  expect(JSON.stringify(editor.getJSON())).toContain('blockMath');
  fireEvent.click(screen.getByRole('button', { name: 'Insert formula' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Formula')).toBeNull();
  editor.destroy();
});
test('ready plan runs without another model call and pending attempts disable duplicate work', async () => {
  jest.mocked(api.fetchProblem).mockResolvedValue({
    ...a,
    status: 'READY_TO_EXECUTE',
    plan: { summary: 'Saved plan', warnings: [] },
    snapshot: {
      ...a.snapshot,
      problem: {
        ...a.snapshot.problem,
        domain: null,
        parameters: [{ symbol: 'missing', value: null, unit: null }],
        assumptions: [],
      },
    },
  });
  jest.mocked(api.fetchProblemExecutions).mockResolvedValue([
    {
      ...e,
      status: 'RUNNING',
      imageId: null,
      result: null,
      verification: null,
      computationStatus: 'RUNNING',
    },
  ]);
  const view = mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('Saved plan', { exact: false });
  await screen.findByText('Execution RUNNING');
  expect(
    (screen.getByRole('button', { name: 'Calculate in sandbox' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText('Domain: missing')).not.toBeNull();
  view.unmount();
  jest.mocked(api.fetchProblemExecutions).mockResolvedValue([
    {
      ...e,
      result: { ...e.result!, plot: null },
      verification: { status: 'FAILED', candidateHash: 'd', receipt: {} },
      computationStatus: 'SUCCEEDED',
    },
  ]);
  jest.mocked(api.executeProblem).mockResolvedValue(e);
  mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByRole('button', { name: 'Calculate in sandbox' });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate in sandbox' }));
  await waitFor(() => expect(api.executeProblem).toHaveBeenCalled());
  expect(api.planProblem).not.toHaveBeenCalled();
  expect(screen.queryByRole('table')).toBeNull();
});
test('load, planning clarification and reproduction failures are shown', async () => {
  jest.mocked(api.fetchProblem).mockRejectedValue(new Error('Not accessible'));
  const view = mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit />);
  expect(screen.getByRole('status').textContent).toContain('Loading');
  await screen.findByRole('alert');
  view.unmount();
  jest.mocked(api.fetchProblem).mockResolvedValue(a);
  jest.mocked(api.fetchProblemExecutions).mockResolvedValue([e]);
  jest.mocked(api.planProblem).mockResolvedValue({
    ...a,
    status: 'WAITING_FOR_INPUT',
    missing: ['Confirm model.'],
  });
  jest.mocked(api.reproduceProblem).mockRejectedValue(new Error('Image unavailable'));
  mount(<ProblemStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('result: 0.5 m/s');
  fireEvent.click(screen.getByRole('button', { name: 'Calculate in sandbox' }));
  await screen.findByRole('alert');
  expect(api.executeProblem).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reproduce frozen run' }));
  await waitFor(() => expect(api.reproduceProblem).toHaveBeenCalled());
});
