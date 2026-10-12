import { apiClient } from '../../../shared/api';
import * as api from './problemApi';
jest.mock('../../../shared/api', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
  },
}));
test('scoped v2 commands use normal CSRF transport and saved IDs', async () => {
  const input = {
    statement: 'S',
    parameters: [],
    unknowns: [],
    domain: null,
    expectedOutputs: [],
    assumptions: [],
    plot: null,
  };
  await api.createProblem('w /', input, null, 'request');
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/workspaces/w%20%2F/analyses', {
    body: {
      schemaVersion: '2.0',
      workload: 'PROBLEM',
      clientRequestId: 'request',
      userPrompt: 'S',
      problem: input,
      origin: null,
      parentAnalysisId: null,
    },
  });
  await api.createProblem('w', input, { id: 'parent' } as api.ProblemAnalysis, 'request');
  await api.fetchProblem('w', 'a');
  await api.planProblem('w', 'a');
  await api.executeProblem('w', 'a');
  await api.fetchProblemExecutions('w', 'a');
  await api.reproduceProblem('w', 'a', 'e');
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/problem/executions/e/reproduce',
    { body: {} },
  );
});
