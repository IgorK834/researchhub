import { apiClient } from '../../../shared/api';
import { searchWorkspace } from './workspaceSearchApi';
afterEach(() => jest.restoreAllMocks());
it('encodes bounded lexical query scope and optional type/cursor with cancellation', async () => {
  const get = jest
    .spyOn(apiClient, 'get')
    .mockResolvedValue({ items: [], nextCursor: null });
  await searchWorkspace('w/1', 'paper & methods', []);
  expect(get).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2F1/search?q=paper+%26+methods&limit=20',
    {},
  );
  const signal = new AbortController().signal;
  await searchWorkspace('w', 'paper', ['SOURCE', 'COMMENT'], 'next', signal);
  expect(get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/search?q=paper&limit=20&types=SOURCE%2CCOMMENT&cursor=next',
    { signal },
  );
});
