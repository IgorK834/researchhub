/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../api/bibliographyImportApi';
import { fetchSources } from '../api/sourceApi';
import { sourceFixture } from '../../../shared/testing/sourceFixtures';
import { bibliographyPreview, bibliographyResult } from '../testing/bibliographyFixtures';
import { BibliographyImportDialog } from './BibliographyImportDialog';
jest.mock('../api/bibliographyImportApi');
jest.mock('../api/sourceApi', () => ({
  ...jest.requireActual('../api/sourceApi'),
  fetchSources: jest.fn(),
}));
let client: QueryClient;
const closed = jest.fn();
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BibliographyImportDialog workspaceId="w" open onClose={closed} />
    </QueryClientProvider>,
  );
}
function chooseFile() {
  fireEvent.change(screen.getByLabelText('Bibliography file'), {
    target: { files: [new File(['@article{test,title={Example}}'], 'library.bib')] },
  });
}
async function preview() {
  chooseFile();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('library.bib');
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.previewBibliographyImport).mockResolvedValue(bibliographyPreview);
  jest.mocked(api.confirmBibliographyImport).mockResolvedValue(bibliographyResult);
  jest.mocked(api.cancelBibliographyImport).mockResolvedValue();
  jest.mocked(api.fetchBibliographyImportResult).mockResolvedValue(bibliographyResult);
  jest
    .mocked(fetchSources)
    .mockResolvedValue([
      sourceFixture({ id: 'source-1', displayName: 'Curated source' }),
      sourceFixture({ id: 'source-2', displayName: 'Other source' }),
    ]);
});
afterEach(() => {
  cleanup();
  client.clear();
});
it('previews every record, keeps malicious markup inert, and saves only explicit decisions', async () => {
  mount();
  await preview();
  expect(screen.getByText(/4 records · 1 ready/)).toBeTruthy();
  expect(screen.getByText('Unsupported type <script>evil()</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText(/1 attachment reference/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Decision for record 2'), {
    target: { value: 'REPLACE_SOURCE:source-1' },
  });
  fireEvent.click(screen.getByLabelText('Add imported tags and collections'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  expect(await screen.findByText('Import complete')).toBeTruthy();
  expect(api.confirmBibliographyImport).toHaveBeenCalledWith('w', 'import-1', [
    {
      recordNumber: 2,
      action: 'REPLACE_SOURCE',
      targetId: 'source-1',
      mergeOrganization: true,
    },
  ]);
  expect(api.cancelBibliographyImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(closed).toHaveBeenCalled();
});
it('can link a ready reference to a separately uploaded source, replace an item, or skip', async () => {
  mount();
  await preview();
  await screen.findAllByRole('option', { name: 'Link to source: Other source' });
  fireEvent.change(screen.getByLabelText('Decision for record 1'), {
    target: { value: 'LINK_SOURCE:source-2' },
  });
  fireEvent.change(screen.getByLabelText('Decision for record 2'), {
    target: { value: 'REPLACE_ITEM:item-1' },
  });
  fireEvent.change(screen.getByLabelText('Decision for record 3'), {
    target: { value: 'SKIP' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  await screen.findByText('Import complete');
  expect(api.confirmBibliographyImport).toHaveBeenCalledWith(
    'w',
    'import-1',
    expect.arrayContaining([
      { recordNumber: 1, action: 'LINK_SOURCE', targetId: 'source-2' },
      { recordNumber: 2, action: 'REPLACE_ITEM', targetId: 'item-1' },
      { recordNumber: 3, action: 'SKIP' },
    ]),
  );
});
it('validates file selection and size before requesting a preview', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  expect(screen.getByRole('alert').textContent).toContain('Choose a bibliography');
  fireEvent.change(screen.getByLabelText('Bibliography file'), {
    target: { files: [new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'huge.bib')] },
  });
  expect(screen.getByRole('alert').textContent).toContain('2 MiB');
  expect(api.previewBibliographyImport).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Export source'), {
    target: { value: 'ZOTERO' },
  });
  await preview();
  expect(api.previewBibliographyImport).toHaveBeenCalledWith(
    'w',
    expect.any(File),
    'ZOTERO',
  );
});
it('waits for preview and confirmation and disables cancellation while a write is pending', async () => {
  let resolvePreview!: (value: api.BibliographyPreview) => void;
  jest.mocked(api.previewBibliographyImport).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
  );
  mount();
  chooseFile();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('Reading preview…');
  expect(
    (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => resolvePreview(bibliographyPreview));
  await screen.findByText('library.bib');
  let resolveConfirm!: (value: api.BibliographyImportResult) => void;
  jest.mocked(api.confirmBibliographyImport).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  await screen.findByText('Confirming…');
  expect(
    (screen.getByLabelText('Decision for record 1') as HTMLSelectElement).disabled,
  ).toBe(true);
  await act(async () => resolveConfirm(bibliographyResult));
  await screen.findByText('Import complete');
});
it('cancel stores no metadata and a failed cancel keeps the preview available', async () => {
  jest.mocked(api.cancelBibliographyImport).mockRejectedValueOnce(new Error('offline'));
  mount();
  await preview();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('alert');
  expect(closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  expect(api.confirmBibliographyImport).not.toHaveBeenCalled();
});
it('reports preview and confirm failures and replays an already confirmed import summary', async () => {
  jest.mocked(api.previewBibliographyImport).mockRejectedValueOnce(new Error('bad file'));
  mount();
  chooseFile();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('library.bib');
  jest.mocked(api.confirmBibliographyImport).mockRejectedValueOnce(new Error('conflict'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(closed).toHaveBeenCalled());
  jest
    .mocked(api.previewBibliographyImport)
    .mockResolvedValue({ ...bibliographyPreview, status: 'CONFIRMED' });
  chooseFile();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('Import complete');
  expect(api.fetchBibliographyImportResult).toHaveBeenCalledWith('w', 'import-1');
});
it('shows existing labels and lets the user resolve a duplicate citation key explicitly', async () => {
  jest.mocked(api.previewBibliographyImport).mockResolvedValue({
    ...bibliographyPreview,
    records: bibliographyPreview.records.map((record) =>
      record.recordNumber === 1
        ? { ...record, status: 'CONFLICT', matches: [] }
        : record.recordNumber === 2
          ? {
              ...record,
              matches: record.matches.map((match) => ({
                ...match,
                tags: ['curated'],
                collections: ['Existing collection'],
                existingBibliography:
                  match.kind === 'SOURCE'
                    ? bibliographyPreview.records[0]!.bibliography!
                    : {
                        title: null,
                        authors: [],
                        publicationYear: null,
                        doi: null,
                        venue: null,
                        url: null,
                        citationKey: null,
                      },
              })),
            }
          : record,
    ),
  });
  mount();
  await preview();
  expect(
    screen.getAllByText(/Existing labels: curated · Existing collection/),
  ).toHaveLength(2);
  expect(screen.getByText('Existing metadata: Curated source')).toBeTruthy();
  expect(screen.getByText('Citation key: fixture2025')).toBeTruthy();
  expect(screen.getByText('No authors · No date')).toBeTruthy();
  const input = screen.getByLabelText('Citation key for record 1');
  fireEvent.change(input, { target: { value: ' ' } });
  fireEvent.change(input, { target: { value: ' unique-key ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  await screen.findByText('Import complete');
  expect(api.confirmBibliographyImport).toHaveBeenCalledWith('w', 'import-1', [
    {
      recordNumber: 1,
      action: 'CREATE',
      acceptedBibliography: {
        ...bibliographyPreview.records[0]!.bibliography,
        citationKey: 'unique-key',
      },
    },
  ]);
});
