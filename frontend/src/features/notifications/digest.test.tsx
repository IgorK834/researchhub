/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DigestPanel, DigestPreferences } from './DigestPanel';
import { digestApi, type DigestFeed } from './digestApi';
import { setLocale } from '../../shared/i18n';
jest.mock('./digestApi');
let client: QueryClient;
const item = {
  workspaceId: 'w',
  category: 'COMMENT' as const,
  count: 8,
  href: '/app/workspaces/w',
};
const feed: DigestFeed = {
  since: '2026-10-01T00:00:00Z',
  through: '2026-10-15T00:00:00Z',
  sinceLastSeen: [item],
  digests: [
    {
      id: 'd',
      windowStart: '2026-10-14T00:00:00Z',
      windowEnd: '2026-10-15T00:00:00Z',
      frequency: 'DAILY',
      items: [item],
    },
  ],
  truncated: true,
};
function mount(node: React.ReactElement): void {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  setLocale('en');
  jest.mocked(digestApi.feed).mockResolvedValue(feed);
  jest.mocked(digestApi.seen).mockResolvedValue();
  jest.mocked(digestApi.preferences).mockResolvedValue([
    {
      workspaceId: 'w',
      sessionLocal: true,
      settings: { frequency: 'DAILY', mutedCategories: ['COMMENT'] },
    },
  ]);
  jest.mocked(digestApi.save).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});
it('groups counts, deep links, windows and explicitly advances the returned cursor', async () => {
  mount(<DigestPanel />);
  await screen.findAllByText('New comment or reply: 8');
  expect(screen.getAllByRole('link')[0]?.getAttribute('href')).toBe('/app/workspaces/w');
  expect(screen.getByText(/Showing a bounded summary/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mark digest as seen' }));
  await waitFor(() => expect(digestApi.seen).toHaveBeenCalledWith(feed.through));
});
it('supports loading, empty activity and failures without exposing cached content', async () => {
  let resolve!: (f: DigestFeed) => void;
  jest.mocked(digestApi.feed).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  mount(<DigestPanel />);
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async () =>
    resolve({ ...feed, sinceLastSeen: [], digests: [], truncated: false }),
  );
  await screen.findByText('No new activity.');
  jest.mocked(digestApi.feed).mockRejectedValue(new Error('revoked'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['digest'] });
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('No new activity.')).toBeNull();
});
it('reports cursor mutation errors', async () => {
  jest.mocked(digestApi.seen).mockRejectedValue(new Error('failed'));
  mount(<DigestPanel />);
  await screen.findByRole('button', { name: 'Mark digest as seen' });
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
});
it('updates frequency, category mutes and restores default session preferences', async () => {
  mount(<DigestPreferences />);
  await screen.findByText('These preferences apply only to this demo session.');
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'WEEKLY' } });
  await waitFor(() =>
    expect(digestApi.save).toHaveBeenCalledWith('w', {
      frequency: 'WEEKLY',
      mutedCategories: ['COMMENT'],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'New comment or reply' }));
  await waitFor(() =>
    expect(digestApi.save).toHaveBeenCalledWith('w', {
      frequency: 'DAILY',
      mutedCategories: [],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'You were mentioned' }));
  await waitFor(() =>
    expect(digestApi.save).toHaveBeenCalledWith('w', {
      frequency: 'DAILY',
      mutedCategories: ['COMMENT', 'MENTION'],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
  await waitFor(() =>
    expect(digestApi.save).toHaveBeenLastCalledWith('w', {
      frequency: 'DAILY',
      mutedCategories: [],
    }),
  );
});
it('reports preference errors and handles persistent empty settings', async () => {
  jest.mocked(digestApi.preferences).mockResolvedValue([
    {
      workspaceId: 'w',
      sessionLocal: false,
      settings: { frequency: 'MUTED', mutedCategories: [] },
    },
  ]);
  jest.mocked(digestApi.save).mockRejectedValue(new Error('failed'));
  mount(<DigestPreferences />);
  await screen.findByLabelText('Frequency');
  expect(
    screen.queryByText('These preferences apply only to this demo session.'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('alert');
  jest.mocked(digestApi.preferences).mockRejectedValue(new Error('forbidden'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['digest-preferences'] });
  });
  await waitFor(() => expect(screen.queryByLabelText('Frequency')).toBeNull());
});
