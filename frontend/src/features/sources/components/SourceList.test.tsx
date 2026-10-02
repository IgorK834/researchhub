/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../api/sourceApi';
import { SOURCE_TYPES } from '../api/sourceTypes';
import { sourceFixture, sourceApiError } from '../../../shared/testing/sourceFixtures';
import { SourceList } from './SourceList';

jest.mock('../api/sourceApi', () => ({
  ...jest.requireActual('../api/sourceApi'),
  fetchSources: jest.fn(),
  fetchSourceProcessing: jest.fn(),
  reprocessSource: jest.fn(),
}));
const list = jest.mocked(api.fetchSources);
const processing = jest.mocked(api.fetchSourceProcessing);
const reprocess = jest.mocked(api.reprocessSource);
let client: QueryClient;
function view(canEdit = false, archived = false, path = '/') {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SourceList
          workspaceId="workspace-1"
          uploaderNames={new Map([['user-1', 'Ada Lovelace']])}
          canEdit={canEdit}
          archived={archived}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  list.mockResolvedValue([]);
  processing.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
  jest.useRealTimers();
});

it('shows every supported type/count, uploader, date and authenticated actions; asks only ready sources', async () => {
  list.mockResolvedValue(
    SOURCE_TYPES.map((sourceType, i) =>
      sourceFixture({
        id: `s-${i}`,
        sourceType,
        displayName: `${sourceType}.file`,
        status: i === 1 ? 'PROCESSING' : i === 2 ? 'UPLOADED' : 'READY',
        uploadedBy: i === 4 ? 'former-user' : 'user-1',
      }),
    ),
  );
  view();
  const table = await screen.findByRole('table', { name: 'Workspace sources' });
  expect(screen.getByText('Grounded in 3 ready sources')).not.toBeNull();
  for (const type of SOURCE_TYPES)
    expect(screen.getByRole('tab', { name: `${type} 1` })).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'All sources 5' })).not.toBeNull();
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(5);
  expect(rows[0]!.textContent).toContain('Ada Lovelace');
  expect(rows[4]!.textContent).toContain('former-user');
  expect(rows[0]!.querySelector('time')?.getAttribute('datetime')).toBe(
    '2026-09-23T10:15:30Z',
  );
  expect(
    within(rows[0]!).getByRole('link', { name: 'Download' }).getAttribute('href'),
  ).toBe('/api/workspaces/workspace-1/sources/s-0/content');
  expect(
    within(rows[0]!).getByRole('link', { name: 'Ask source' }).getAttribute('href'),
  ).toBe('/app/workspaces/workspace-1/ask?askSource=s-0');
  expect(within(rows[1]!).queryByRole('link', { name: 'Ask source' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'CSV 1' }));
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.queryByRole('link', { name: 'PDF.file' })).toBeNull();
});
it('keeps viewer upload/retry controls absent, including the upload fragment', async () => {
  list.mockResolvedValue([
    sourceFixture({ status: 'FAILED', failureSummary: 'The workbook is encrypted.' }),
  ]);
  view(false, false, '/#upload-source-heading');
  expect(await screen.findByText('Failure: The workbook is encrypted.')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Upload source' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('uses reprocess for Retry and updates the row; reports retry errors', async () => {
  list.mockResolvedValue([sourceFixture({ status: 'FAILED', failureSummary: null })]);
  reprocess
    .mockRejectedValueOnce(sourceApiError('Please try later.'))
    .mockResolvedValueOnce(sourceFixture({ status: 'UPLOADED' }));
  view(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Please try later.');
  list.mockResolvedValue([sourceFixture({ status: 'UPLOADED' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Uploaded')).not.toBeNull();
  expect(reprocess).toHaveBeenCalledWith('workspace-1', 'source-1');
});
it('opens the upload dialog from the empty action and supports empty type tabs', async () => {
  view(true);
  expect(await screen.findByText('Bring in your research material')).not.toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'TXT 0' }));
  expect(screen.getByText('No TXT sources in this workspace yet.')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Upload source' }));
  expect(screen.getByRole('dialog', { name: 'Upload sources' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('shows archive information and refreshes an empty library', async () => {
  view(false, true);
  await screen.findByText('Bring in your research material');
  expect(screen.getByRole('status').textContent).toContain('archived');
  list.mockResolvedValue([sourceFixture()]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));
  expect(await screen.findByRole('link', { name: 'research.pdf' })).not.toBeNull();
});
it('reports loading and errors without a false grounding count', async () => {
  list.mockRejectedValue(sourceApiError('Service unavailable'));
  view(true);
  expect(screen.getByRole('status').textContent).toBe('Loading sources…');
  expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable');
  expect(screen.queryByText(/Grounded in/)).toBeNull();
});
it('automatically updates processing rows and the ready count', async () => {
  jest.useFakeTimers();
  list
    .mockResolvedValueOnce([sourceFixture({ status: 'PROCESSING' })])
    .mockResolvedValue([sourceFixture()]);
  processing.mockResolvedValue({
    jobId: 'job',
    status: 'RUNNING',
    stage: 'EXTRACT',
    progress: 42,
    attempt: 1,
  });
  view();
  await screen.findByText('Reading source · 42%');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2100);
  });
  await waitFor(() =>
    expect(screen.getByText('Grounded in 1 ready source')).not.toBeNull(),
  );
  expect(screen.queryByText('Reading source · 42%')).toBeNull();
});
