import { apiClient } from '../../shared/api';
import { memberApi } from './memberApi';
jest.mock('../../shared/api', () => ({ apiClient: { get: jest.fn() } }));
it('searches only the encoded workspace roster', async () => {
  await memberApi.search('w/x', 'Ada & Ben');
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%2Fx/people?q=Ada%20%26%20Ben',
  );
});
