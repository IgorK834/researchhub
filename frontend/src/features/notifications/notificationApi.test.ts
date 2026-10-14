import { apiClient, CSRF_PRIMING_PATH } from '../../shared/api';
import { notificationApi } from './notificationApi';
jest.mock('../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
it('uses scoped encoded cursors, bounded mark-all, CSRF and mute contracts', async () => {
  await notificationApi.list(null, false, '');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/notifications?limit=20&unread=false',
  );
  await notificationApi.list('a+b', true, 'MENTION', 1);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/notifications?limit=1&unread=true&cursor=a%2Bb&type=MENTION',
  );
  await notificationApi.read('a/b');
  expect(apiClient.get).toHaveBeenLastCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/notifications/a%2Fb/read');
  await notificationApi.readAll('date');
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/notifications/read-all', {
    body: { before: 'date', limit: 100 },
  });
  await notificationApi.preferences('w/x');
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/notifications/preferences/w%2Fx');
  await notificationApi.mute('w', 'COMMENT', true);
  expect(apiClient.put).toHaveBeenLastCalledWith('/api/notifications/preferences/w', {
    body: { type: 'COMMENT', muted: true },
  });
});
