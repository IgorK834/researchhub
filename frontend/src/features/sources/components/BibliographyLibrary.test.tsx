/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../api/bibliographyImportApi';
import { bibliography } from '../testing/bibliographyFixtures';
import { BibliographyLibrary } from './BibliographyLibrary';
jest.mock('../api/bibliographyImportApi');
const item: api.BibliographyItem = {
  id: 'i',
  sourceId: null,
  itemType: 'article-journal',
  bibliography,
  tags: ['unicode'],
  collections: ['papers'],
  updatedAt: '2026-10-13T10:00:00Z',
};
let client: QueryClient;
function mount(canEdit = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BibliographyLibrary workspaceId="w" canEdit={canEdit} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show bibliography' }));
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(api.fetchBibliographyItems)
    .mockResolvedValue({ items: [item], nextOffset: -1 });
  jest.mocked(api.saveBibliographyItem).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  client.clear();
});
it('lists imported collections and edits metadata using the displayed version', async () => {
  mount();
  await screen.findByText('Łódź synthetic paper');
  fireEvent.click(screen.getByRole('button', { name: 'Edit reference' }));
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Curated paper' },
  });
  fireEvent.change(screen.getByLabelText('Collections (semicolon-separated)'), {
    target: { value: 'papers; reviewed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save reference' }));
  await waitFor(() =>
    expect(api.saveBibliographyItem).toHaveBeenCalledWith(
      'w',
      expect.objectContaining({
        updatedAt: item.updatedAt,
        bibliography: expect.objectContaining({ title: 'Curated paper' }),
        collections: ['papers', 'reviewed'],
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('reports stale metadata without discarding edits, and never saves on Close', async () => {
  jest.mocked(api.saveBibliographyItem).mockRejectedValue(new Error('stale'));
  mount();
  await screen.findByText('Łódź synthetic paper');
  fireEvent.click(screen.getByRole('button', { name: 'Edit reference' }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reference' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Draft title');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.saveBibliographyItem).toHaveBeenCalledTimes(1);
});
it('supports readonly partial references, empty results, errors and pagination', async () => {
  jest
    .mocked(api.fetchBibliographyItems)
    .mockResolvedValueOnce({
      items: [
        {
          ...item,
          bibliography: {
            ...bibliography,
            title: null,
            authors: [],
            publicationYear: null,
            doi: null,
            citationKey: null,
          },
        },
      ],
      nextOffset: 50,
    })
    .mockResolvedValueOnce({ items: [], nextOffset: -1 })
    .mockResolvedValue({ items: [], nextOffset: -1 });
  mount(false);
  await screen.findByText('Untitled reference');
  expect(screen.queryByRole('button', { name: 'Edit reference' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next references' }));
  await screen.findByText(/No bibliography entries yet/);
  expect(api.fetchBibliographyItems).toHaveBeenCalledWith(
    'w',
    50,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous references' }));
  await waitFor(() =>
    expect(api.fetchBibliographyItems).toHaveBeenLastCalledWith(
      'w',
      0,
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide bibliography' }));
  expect(screen.queryByText('Untitled reference')).toBeNull();
});
it('saves partial fields as null and renders failed collection reads', async () => {
  jest
    .mocked(api.fetchBibliographyItems)
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue({
      items: [
        {
          ...item,
          bibliography: {
            title: null,
            authors: [],
            publicationYear: null,
            doi: null,
            venue: null,
            url: null,
            citationKey: null,
          },
        },
      ],
      nextOffset: -1,
    });
  mount();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Hide bibliography' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show bibliography' }));
  await screen.findByText('Untitled reference');
  fireEvent.click(screen.getByRole('button', { name: 'Edit reference' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save reference' }));
  await waitFor(() =>
    expect(api.saveBibliographyItem).toHaveBeenCalledWith(
      'w',
      expect.objectContaining({
        bibliography: {
          title: null,
          authors: [],
          publicationYear: null,
          doi: null,
          venue: null,
          url: null,
          citationKey: null,
        },
      }),
    ),
  );
});
