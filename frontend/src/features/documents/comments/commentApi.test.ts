import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import { commentApi } from './commentApi';

jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
it('uses explicit scoped contracts and primes CSRF before every mutation', async () => {
  const path = '/api/workspaces/w/documents/d/comments';
  const anchor = { strategy: 'TEXT_MARK_V1' as const, id: 'id', quote: 'Quote' };
  await commentApi.list('w', 'd');
  expect(apiClient.get).toHaveBeenLastCalledWith(path);
  await commentApi.thread('w', 'd', 'id');
  expect(apiClient.get).toHaveBeenLastCalledWith(`${path}/id`);
  await commentApi.create('w', 'd', anchor, 'Body');
  expect(apiClient.get).toHaveBeenLastCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.post).toHaveBeenLastCalledWith(path, {
    body: { id: 'id', anchor, body: 'Body' },
  });
  await commentApi.reply('w', 'd', 'id', 'reply', 'Response');
  expect(apiClient.post).toHaveBeenLastCalledWith(`${path}/id/replies`, {
    body: { id: 'reply', body: 'Response' },
  });
  await commentApi.status('w', 'd', 'id', 'RESOLVED');
  expect(apiClient.patch).toHaveBeenLastCalledWith(`${path}/id`, {
    body: { status: 'RESOLVED' },
  });
  await commentApi.evidence('w', 'd', 'id', 'request');
  expect(apiClient.get).toHaveBeenLastCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.post).toHaveBeenLastCalledWith(`${path}/id/ai-evidence`, {
    body: { id: 'request' },
  });
  await commentApi.acceptEvidence('w', 'd', 'id', 'request', 'chunk');
  expect(apiClient.get).toHaveBeenLastCalledWith(CSRF_PRIMING_PATH);
  expect(apiClient.post).toHaveBeenLastCalledWith(
    `${path}/id/ai-evidence/request/accept`,
    { body: { chunkId: 'chunk' } },
  );
});

it('sends typed ranges and revisions for explicit mentions and edits', async () => {
  const anchor = { strategy: 'TEXT_MARK_V1' as const, id: 'a', quote: 'Evidence' };
  const mentions = [{ userId: 'u', displayLabel: 'User', start: 0, end: 5 }];
  await commentApi.create('w', 'd', anchor, '@User', mentions);
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/api/workspaces/w/documents/d/comments',
    { body: { id: 'a', anchor, body: '@User', mentions } },
  );
  await commentApi.reply('w', 'd', 'c', 'r', '@User', mentions);
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/api/workspaces/w/documents/d/comments/c/replies',
    { body: { id: 'r', body: '@User', mentions } },
  );
  await commentApi.edit('w', 'd', 'c', 2, 'Text', []);
  expect(apiClient.put).toHaveBeenLastCalledWith(
    '/api/workspaces/w/documents/d/comments/c/body',
    { body: { revision: 2, body: 'Text', mentions: [] } },
  );
});
