import { apiClient } from '../../shared/api';
import { reviewTaskApi, type ReviewTask } from './reviewTaskApi';
jest.mock('../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
it('uses bounded workspace pages, explicit targets and optimistic revisions', async () => {
  await reviewTaskApi.list('w/x', 'MINE', 'c+d');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2Fx/review-tasks?filter=MINE&limit=20&cursor=c%2Bd',
  );
  await reviewTaskApi.list('w', 'ALL', null);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/review-tasks?filter=ALL&limit=20',
  );
  await reviewTaskApi.get('w', 't/x');
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/workspaces/w/review-tasks/t%2Fx');
  const input = { title: 'Review', description: '', assignee: null, dueAt: null },
    target = { targetType: 'DOCUMENT' as const, targetId: 'd' };
  await reviewTaskApi.create('w', 'id', target, input);
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/workspaces/w/review-tasks', {
    body: { id: 'id', ...target, ...input },
  });
  await reviewTaskApi.update('w', { id: 't', revision: 2 } as ReviewTask, input, 'DONE');
  expect(apiClient.patch).toHaveBeenLastCalledWith('/api/workspaces/w/review-tasks/t', {
    body: { revision: 2, ...input, status: 'DONE' },
  });
});
