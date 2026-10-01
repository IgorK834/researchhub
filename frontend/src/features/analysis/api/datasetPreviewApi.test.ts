import { apiClient } from '../../../shared/api';
import { datasetPreviewPath, fetchDatasetPreview } from './datasetPreviewApi';

jest.mock('../../../shared/api', () => ({ apiClient: { get: jest.fn() } }));
const get = jest.mocked(apiClient.get);

beforeEach(() => jest.resetAllMocks());

it('addresses one immutable version inside its workspace and encodes every segment', () => {
  expect(datasetPreviewPath('w 1', 's/2', 'v?3')).toBe(
    '/api/workspaces/w%201/analysis/datasets/s%2F2/versions/v%3F3/preview',
  );
});

it('requests the bounded preview and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  get.mockResolvedValue({ schemaVersion: '1.0' });

  await expect(fetchDatasetPreview('w', 's', 'v', signal)).resolves.toEqual({
    schemaVersion: '1.0',
  });
  expect(get).toHaveBeenCalledWith(
    '/api/workspaces/w/analysis/datasets/s/versions/v/preview',
    {
      signal,
    },
  );

  await fetchDatasetPreview('w', 's', 'v');
  expect(get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analysis/datasets/s/versions/v/preview',
    {},
  );
});

it('lets a failure propagate unchanged so the UI can branch on its code', async () => {
  get.mockRejectedValue(new Error('Conflict'));
  await expect(fetchDatasetPreview('w', 's', 'v')).rejects.toThrow('Conflict');
});
