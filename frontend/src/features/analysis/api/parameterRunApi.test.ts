import { apiClient } from '../../../shared/api';
import { parameterRunApi } from './parameterRunApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/csrf',
}));
it('uses typed server routes and primes CSRF', async () => {
  await parameterRunApi.definitions('w', 'a');
  const body = {
    idempotencyKey: 'key',
    inputMode: 'ORIGINAL' as const,
    parameters: { x: { type: 'DECIMAL' as const, value: '2', unit: 'm' } },
    plot: null,
  };
  await parameterRunApi.run('w', 'a', body);
  expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/w/analyses/a/parameters');
  expect(apiClient.get).toHaveBeenCalledWith('/csrf');
  expect(apiClient.post).toHaveBeenCalledWith('/api/workspaces/w/analyses/a/runs', {
    body,
  });
});
