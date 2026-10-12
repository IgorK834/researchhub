import { apiClient } from '../../../shared/api';
import { fetchSolution } from './solutionApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({}) },
}));
test('solution read uses scoped exact execution and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  await fetchSolution('w /', 'a /', 'e /', signal);
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%20%2F/analyses/a%20%2F/executions/e%20%2F/solution',
    { signal },
  );
});
