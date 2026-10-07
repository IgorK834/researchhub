/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExternalSources } from './ExternalSources';
import {
  fetchExternalAvailability,
  fetchExternalSources,
  searchExternalSources,
  recordExternalSource,
} from '../api/externalSourceApi';
import {
  externalSearch,
  externalReference,
  externalPage,
} from '../testing/searchFixtures';
jest.mock('../api/externalSourceApi', () => ({
  fetchExternalAvailability: jest.fn(),
  fetchExternalSources: jest.fn(),
  searchExternalSources: jest.fn(),
  recordExternalSource: jest.fn(),
}));
const availability = jest.mocked(fetchExternalAvailability),
  references = jest.mocked(fetchExternalSources),
  search = jest.mocked(searchExternalSources),
  record = jest.mocked(recordExternalSource);
function mount(canEdit = true) {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <ExternalSources workspaceId="w1" canEdit={canEdit} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function discover() {
  fireEvent.click(
    await screen.findByRole('checkbox', { name: 'Enable external search' }),
  );
  fireEvent.change(screen.getByLabelText('Search the external web'), {
    target: { value: 'solar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  await screen.findByRole('button', { name: 'Record reference' });
}
beforeEach(() => {
  jest.clearAllMocks();
  availability.mockResolvedValue({ available: true, provider: 'BRAVE' });
  references.mockResolvedValue(externalPage());
  search.mockResolvedValue(externalSearch);
  record.mockResolvedValue(externalReference);
});
it('keeps external search off until explicit consent, labels web discoveries and records their provenance separately', async () => {
  mount();
  await screen.findByRole('checkbox');
  expect(search).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Search the external web')).toBeNull();
  expect(screen.getByText(/AI answers and report citations continue/)).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'Workspace sources only' }).getAttribute('href'),
  ).toBe('/app/workspaces/w1/sources');
  await discover();
  expect(search).toHaveBeenCalledWith('w1', 'solar', true, expect.any(AbortSignal));
  expect(screen.getAllByText('External web').length).toBeGreaterThan(1);
  expect(screen.getByRole('link', { name: 'Solar web paper' }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
  expect(document.querySelector('script')).toBeNull();
  references.mockResolvedValue(externalPage([externalReference]));
  fireEvent.click(screen.getByRole('button', { name: 'Record reference' }));
  await screen.findByRole('button', { name: 'Reference recorded' });
  expect(record).toHaveBeenCalledWith('w1', 'search1', 'hit1');
  expect(
    (screen.getByRole('button', { name: 'Reference recorded' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await screen.findByText('Discovery provenance');
  expect(screen.getByText('a'.repeat(64))).not.toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.queryByRole('button', { name: 'Record reference' })).toBeNull();
  expect(screen.queryByLabelText('Search the external web')).toBeNull();
});
it('offers viewers only recorded external references and never search controls', async () => {
  references.mockResolvedValue(externalPage([externalReference]));
  mount(false);
  await screen.findByText('Discovery provenance');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/requires editor access/)).not.toBeNull();
  expect(search).not.toHaveBeenCalled();
});
it('communicates unconfigured discovery and loading without hiding recorded references', async () => {
  availability.mockResolvedValue({ available: false, provider: 'BRAVE' });
  mount();
  expect(screen.getByText('Checking external search availability…')).not.toBeNull();
  expect(screen.getByText('Loading recorded references…')).not.toBeNull();
  await screen.findByText(/External search is not configured/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  await screen.findByRole('heading', { name: 'No external references recorded' });
});
it('retries availability and saved reference failures', async () => {
  availability.mockRejectedValueOnce(new Error('Offline'));
  references.mockRejectedValueOnce(new Error('Offline'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry availability' }));
  await screen.findByRole('checkbox');
  fireEvent.click(await screen.findByRole('button', { name: 'Retry references' }));
  await screen.findByRole('heading', { name: 'No external references recorded' });
});
it('keeps discovery and recording errors visible and handles empty external results', async () => {
  search.mockRejectedValueOnce(new Error('Provider failed'));
  mount();
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Search the external web'), {
    target: { value: 'solar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not search external sources:',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  await screen.findByRole('button', { name: 'Record reference' });
  record.mockRejectedValueOnce(new Error('Cannot record'));
  fireEvent.click(screen.getByRole('button', { name: 'Record reference' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not record reference:',
  );
  search.mockResolvedValue({ ...externalSearch, results: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  await screen.findByText('No external results. Try a different query.');
  expect(screen.queryByText(/Could not record reference/)).toBeNull();
});
it('aborts pending discovery when consent is withdrawn and on unmount', async () => {
  search.mockImplementation(() => new Promise(() => undefined));
  const view = mount();
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Search the external web'), {
    target: { value: 'solar' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  await screen.findByRole('button', { name: 'Searching external web…' });
  const signal = search.mock.calls.at(-1)![3]!;
  fireEvent.click(screen.getByRole('checkbox'));
  expect(signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Search external web' }));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  const nextSignal = search.mock.calls.at(-1)![3]!;
  view.unmount();
  expect(nextSignal.aborted).toBe(true);
});
it('paginates recorded references without broadening the workspace or evidence type', async () => {
  references.mockImplementation(async (_workspace, page) => ({
    ...externalPage([externalReference]),
    page: page ?? 0,
    totalElements: 31,
    hasNext: page === 0,
  }));
  mount();
  await screen.findByText('Discovery provenance');
  fireEvent.click(screen.getByRole('button', { name: 'Next references' }));
  await screen.findByText('Page 2 · 31 references');
  expect(references).toHaveBeenLastCalledWith('w1', 1, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Previous references' }));
  await screen.findByText('Page 1 · 31 references');
});
it('shows a missing snippet explicitly', async () => {
  references.mockResolvedValue(externalPage([{ ...externalReference, snippet: '' }]));
  mount();
  await screen.findByText('No search snippet provided.');
});
