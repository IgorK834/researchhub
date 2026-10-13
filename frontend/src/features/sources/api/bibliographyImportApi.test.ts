/** @jest-environment jsdom */
import { apiClient } from '../../../shared/api';
import * as api from './bibliographyImportApi';
import { bibliography } from '../testing/bibliographyFixtures';
afterEach(() => jest.restoreAllMocks());
it('uses authenticated multipart preview and CSRF-protected confirm/cancel paths', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue(undefined);
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(undefined);
  const remove = jest.spyOn(apiClient, 'delete').mockResolvedValue(undefined);
  const file = new File(['bib'], 'library.bib');
  await api.previewBibliographyImport('w/1', file, 'MENDELEY');
  expect(post).toHaveBeenCalledWith(
    '/api/workspaces/w%2F1/bibliography/imports?origin=MENDELEY',
    expect.objectContaining({ formData: expect.any(FormData) }),
  );
  const data = post.mock.calls[0]![1]!.formData!;
  expect((data.get('file') as File).name).toBe('library.bib');
  await api.confirmBibliographyImport('w/1', 'i/1', []);
  await api.cancelBibliographyImport('w/1', 'i/1');
  expect(post).toHaveBeenLastCalledWith(
    '/api/workspaces/w%2F1/bibliography/imports/i%2F1/confirm',
    { body: { decisions: [] } },
  );
  expect(remove).toHaveBeenCalledWith('/api/workspaces/w%2F1/bibliography/imports/i%2F1');
  expect(get).toHaveBeenCalledTimes(3);
});
it('reads saved summaries and paginated items, propagates cancellation and optimistic metadata versions', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue(undefined);
  const put = jest.spyOn(apiClient, 'put').mockResolvedValue(undefined);
  await api.fetchBibliographyImportResult('w', 'i');
  await api.fetchBibliographyItems('w', 50);
  const signal = new AbortController().signal;
  await api.fetchBibliographyItems('w', 0, signal);
  expect(get).toHaveBeenLastCalledWith('/api/workspaces/w/bibliography/items?offset=0', {
    signal,
  });
  await api.saveBibliographyItem('w', {
    id: 'item',
    sourceId: null,
    itemType: 'report',
    bibliography,
    tags: ['tag'],
    collections: ['papers'],
    updatedAt: '2026-10-13T10:00:00Z',
  });
  expect(put).toHaveBeenCalledWith(
    '/api/workspaces/w/bibliography/items/item',
    expect.objectContaining({
      body: expect.objectContaining({ expectedUpdatedAt: '2026-10-13T10:00:00Z' }),
    }),
  );
});
