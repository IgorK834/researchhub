import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import {
  acceptAuthoring,
  fetchAuthoringSuggestion,
  rejectAuthoring,
  suggestAuthoring,
  type AuthoringCommand,
} from './authoringApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const input: AuthoringCommand = {
  kind: 'DRAFT',
  expectedRevision: 1,
  placementBlock: 1,
  from: null,
  to: null,
  action: null,
  instruction: 'Theory',
  selectedSourceIds: ['source'],
  lengthTarget: 300,
  stylePreset: 'ACADEMIC',
  citationRequired: true,
};
beforeEach(() => {
  jest.resetAllMocks();
});
test('authoring transport primes CSRF, preserves explicit selection and encodes scope', async () => {
  post.mockResolvedValue({ id: 'suggestion' });
  await expect(suggestAuthoring('w/1', 'd/1', input)).resolves.toEqual({
    id: 'suggestion',
  });
  expect(get).toHaveBeenCalledWith(CSRF_PRIMING_PATH);
  expect(post).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/documents/d%2F1/ai/suggestions',
    { body: input },
  );
});
test('read, reject and retried approval use the same scoped suggestion identity', async () => {
  get.mockResolvedValue({ id: 's' });
  await fetchAuthoringSuggestion('w', 'd', 's/1');
  expect(get).toHaveBeenCalledWith('/api/workspaces/w/documents/d/ai/suggestions/s%2F1');
  await rejectAuthoring('w', 'd', 's');
  expect(post).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/d/ai/suggestions/s/reject',
  );
  const acceptance = {
    expectedRevision: 1,
    editedText: 'Reviewed',
    citationChunkId: null,
  };
  await acceptAuthoring('w', 'd', 's', acceptance);
  await acceptAuthoring('w', 'd', 's', acceptance);
  expect(post).toHaveBeenLastCalledWith(
    '/api/workspaces/w/documents/d/ai/suggestions/s/accept',
    { body: acceptance },
  );
});
test('approval failures propagate without an automatic second mutation', async () => {
  const failure = new Error('Conflict');
  post.mockRejectedValue(failure);
  await expect(
    acceptAuthoring('w', 'd', 's', {
      expectedRevision: 1,
      editedText: null,
      citationChunkId: null,
    }),
  ).rejects.toBe(failure);
  expect(post).toHaveBeenCalledTimes(1);
});
