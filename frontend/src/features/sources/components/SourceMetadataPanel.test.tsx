/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../api/sourceApi';
import { SourceMetadataPanel } from './SourceMetadataPanel';
import { sourceFixture, sourceApiError } from '../../../shared/testing/sourceFixtures';
import { queryKeys } from '../../../shared/api';

jest.mock('../api/sourceApi', () => ({
  ...jest.requireActual('../api/sourceApi'),
  saveSourceBibliography: jest.fn(),
  saveSourceOrganization: jest.fn(),
}));
let client: QueryClient;
const source = sourceFixture({
  bibliography: {
    title: 'Solar study',
    authors: ['Ada', 'Smith, J.'],
    publicationYear: 2025,
    doi: '10.1234/abc',
    venue: 'Nature',
    url: 'https://example.org/paper',
    citationKey: 'Ada2025',
  },
  tags: ['review'],
  collections: ['papers'],
});
function view(canEdit = true, current = source) {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SourceMetadataPanel source={current} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});

it('shows all normalized fields and safe descriptive links to readers', () => {
  view(false);
  for (const value of [
    'Solar study',
    'Ada; Smith, J.',
    '2025',
    '10.1234/abc',
    'Nature',
    'Ada2025',
    'review',
    'papers',
  ])
    expect(screen.getByText(value)).not.toBeNull();
  expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByRole('button', { name: 'Edit source details' })).toBeNull();
});
it('shows empty fields and keeps a read-only panel compatible with older cached metadata', () => {
  view(
    false,
    sourceFixture({
      bibliography: undefined,
      tags: undefined,
      collections: undefined,
    } as unknown as Partial<api.WorkspaceSource>),
  );
  expect(screen.getAllByText('Not set')).toHaveLength(7);
  expect(screen.getAllByText('None')).toHaveLength(2);
});
it('saves bibliography and organization separately, updates caches and allows clearing fields', async () => {
  view();
  jest.mocked(api.saveSourceBibliography).mockResolvedValue(source);
  jest.mocked(api.saveSourceOrganization).mockResolvedValue(source);
  const invalidation = jest.spyOn(client, 'invalidateQueries');
  fireEvent.click(screen.getByRole('button', { name: 'Edit source details' }));
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Revised study' },
  });
  fireEvent.change(screen.getByLabelText('DOI'), { target: { value: '10.1234/new' } });
  fireEvent.change(screen.getByLabelText('Journal/conference'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('URL'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Citation key'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Authors'), {
    target: { value: 'Smith, J.\n\n  Ada  ' },
  });
  fireEvent.change(screen.getByLabelText('Publication year'), {
    target: { value: '2026' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save bibliography' }));
  await screen.findByText('Bibliography saved.');
  expect(api.saveSourceBibliography).toHaveBeenCalledWith('workspace-1', 'source-1', {
    title: 'Revised study',
    authors: ['Smith, J.', 'Ada'],
    publicationYear: 2026,
    doi: '10.1234/new',
    venue: null,
    url: null,
    citationKey: null,
  });
  expect(client.getQueryData(queryKeys.source('workspace-1', 'source-1'))).toEqual(
    source,
  );
  expect(invalidation).toHaveBeenCalledWith({
    queryKey: queryKeys.sources('workspace-1'),
  });
  fireEvent.change(screen.getByLabelText('Publication year'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save bibliography' }));
  await waitFor(() =>
    expect(api.saveSourceBibliography).toHaveBeenLastCalledWith(
      'workspace-1',
      'source-1',
      expect.objectContaining({ publicationYear: null }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'New name' },
  });
  fireEvent.change(screen.getByLabelText('Tags'), {
    target: { value: 'Energy\n\nReview' },
  });
  fireEvent.change(screen.getByLabelText('Collections'), {
    target: { value: ' Papers ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization' }));
  await screen.findByText('Organization saved.');
  expect(api.saveSourceOrganization).toHaveBeenCalledWith('workspace-1', 'source-1', {
    displayName: 'New name',
    tags: ['Energy', 'Review'],
    collections: ['Papers'],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps edits on server rejection and disables each pending save', async () => {
  view();
  let finish!: (value: api.WorkspaceSource) => void;
  jest
    .mocked(api.saveSourceBibliography)
    .mockRejectedValueOnce(sourceApiError('Duplicate citation key'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  jest
    .mocked(api.saveSourceOrganization)
    .mockRejectedValue(sourceApiError('Workspace is archived'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit source details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save bibliography' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Duplicate citation key',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save organization' }));
  await screen.findByText('Workspace is archived');
  fireEvent.click(screen.getByRole('button', { name: 'Save bibliography' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Saving bibliography…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  await act(async () => finish(source));
  await screen.findByText('Bibliography saved.');
});
