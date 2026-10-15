import { apiClient, CSRF_PRIMING_PATH } from '../../shared/api';
import { digestApi } from './digestApi';
jest.mock('../../shared/api', () => ({
  apiClient: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/csrf',
}));
afterEach(() => jest.clearAllMocks());
it('uses bounded in-app routes and primes CSRF for every write', async () => {
  await digestApi.feed();
  await digestApi.preferences();
  await digestApi.save('w/x', { frequency: 'WEEKLY', mutedCategories: ['COMMENT'] });
  await digestApi.seen('now');
  expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/digests');
  expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/digests/preferences');
  expect(apiClient.get).toHaveBeenCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.put).toHaveBeenCalledWith(
    '/api/notifications/digests/preferences/w%2Fx',
    { body: { frequency: 'WEEKLY', mutedCategories: ['COMMENT'] } },
  );
  expect(apiClient.post).toHaveBeenCalledWith('/api/notifications/digests/seen', {
    body: { through: 'now' },
  });
});
