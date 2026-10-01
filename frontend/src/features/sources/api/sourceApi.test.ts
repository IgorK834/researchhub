import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import {
  fetchSourceVersions,
  replaceSource,
  sourceContentPath,
  sourceVersionContentPath,
} from './sourceApi';

jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
  resolveApiUrl: (path: string) => path,
}));
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);

beforeEach(() => jest.resetAllMocks());

it('replaces a source by posting the file to its versions collection after priming CSRF', async () => {
  post.mockResolvedValue({ id: 's', activeVersionNumber: 2 });
  const file = new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' });
  const progress = jest.fn();

  await expect(replaceSource('w', 's', file, progress)).resolves.toEqual({
    id: 's',
    activeVersionNumber: 2,
  });

  expect(get).toHaveBeenCalledWith(CSRF_PRIMING_PATH);
  const [path, options] = post.mock.calls[0] ?? [];
  expect(path).toBe('/api/workspaces/w/sources/s/versions');
  expect((options?.formData?.get('file') as File).name).toBe('data.csv');
  expect(options?.onUploadProgress).toBe(progress);

  await replaceSource('w', 's', file);
  expect(post.mock.calls[1]?.[1]).not.toHaveProperty('onUploadProgress');
});

it('lists the versions of one source and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  get.mockResolvedValue([]);

  await fetchSourceVersions('w', 's', signal);
  expect(get).toHaveBeenCalledWith('/api/workspaces/w/sources/s/versions', { signal });

  await fetchSourceVersions('w', 's');
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w/sources/s/versions', {});
});

it('addresses the bytes of the active file and of one immutable version separately', () => {
  expect(sourceContentPath('w', 's')).toBe('/api/workspaces/w/sources/s/content');
  expect(sourceVersionContentPath('w', 's', 'v1')).toBe(
    '/api/workspaces/w/sources/s/versions/v1/content',
  );
});
