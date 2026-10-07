import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import {
  fetchSourceVersions,
  searchSources,
  fetchSourceFacets,
  saveSourceBibliography,
  saveSourceOrganization,
  replaceSource,
  sourceContentPath,
  sourceVersionContentPath,
} from './sourceApi';

jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
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

it('encodes literal search filters, keeps them workspace scoped and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  await searchSources(
    'w',
    {
      query: '100%_ & study',
      type: 'PDF',
      uploader: 'u',
      status: 'READY',
      tag: '',
      collection: 'papers',
      page: 2,
    },
    signal,
  );
  const [path, options] = get.mock.calls[0]!;
  const url = new URL(path, 'http://local');
  expect(url.pathname).toBe('/api/workspaces/w/sources/search');
  expect(url.searchParams.get('query')).toBe('100%_ & study');
  expect(url.searchParams.has('tag')).toBe(false);
  expect(url.searchParams.get('page')).toBe('2');
  expect(options?.signal).toBe(signal);
  await searchSources('w', {});
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w/sources/search?', {});
  await fetchSourceFacets('w', signal);
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w/sources/facets', { signal });
  await fetchSourceFacets('w');
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w/sources/facets', {});
});
it('saves bibliographic and organizational contracts separately with CSRF priming', async () => {
  const metadata = {
    title: 'Paper',
    authors: ['Smith, J.'],
    publicationYear: 2025,
    doi: '10.1234/abc',
    venue: 'Journal',
    url: null,
    citationKey: 'Smith2025',
  };
  const organization = {
    displayName: 'Study',
    tags: ['review'],
    collections: ['papers'],
  };
  await saveSourceBibliography('w', 's', metadata);
  expect(apiClient.put).toHaveBeenCalledWith('/api/workspaces/w/sources/s/bibliography', {
    body: metadata,
  });
  await saveSourceOrganization('w', 's', organization);
  expect(apiClient.put).toHaveBeenLastCalledWith(
    '/api/workspaces/w/sources/s/organization',
    { body: organization },
  );
  expect(get.mock.calls).toEqual([[CSRF_PRIMING_PATH], [CSRF_PRIMING_PATH]]);
});
