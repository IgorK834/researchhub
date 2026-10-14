/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import {
  notificationApi,
  type NotificationPage,
  type ProductNotification,
} from './notificationApi';
import { setLocale } from '../../shared/i18n';
jest.mock('./notificationApi', () => ({
  notificationTypes: [
    'COMMENT',
    'MENTION',
    'ANALYSIS_COMPLETED',
    'ANALYSIS_FAILED',
    'REVIEW_TASK',
    'ATTENTION',
  ],
  notificationApi: {
    list: jest.fn(),
    read: jest.fn(),
    readAll: jest.fn(),
    preferences: jest.fn(),
    mute: jest.fn(),
  },
}));
const date = '2026-10-14T10:00:00Z';
const item: ProductNotification = {
  workspaceLabel: '<Workspace>',
  targetLabel: 'Report',
  id: 'n',
  eventId: 'e',
  workspaceId: 'w',
  type: 'MENTION',
  targetType: 'COMMENT',
  targetId: 'c',
  documentId: 'd',
  createdAt: date,
  readAt: null,
  href: '/app/workspaces/w/documents/d#comment-c',
};
const page: NotificationPage = {
  items: [item],
  nextCursor: null,
  unreadCount: 1,
  countCapped: false,
};
let client: QueryClient;
function setup(workspace = true) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationBell userId="u" {...(workspace ? { workspaceId: 'w' } : {})} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  await screen.findByRole('dialog');
}
beforeEach(() => {
  setLocale('en');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.mocked(notificationApi.list).mockResolvedValue(page);
  jest.mocked(notificationApi.preferences).mockResolvedValue([]);
  jest.mocked(notificationApi.read).mockResolvedValue();
  jest.mocked(notificationApi.readAll).mockResolvedValue({ updated: 1 });
  jest.mocked(notificationApi.mute).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});
it('shows persisted unread count, marks a row read and restores focus with Escape', async () => {
  setup();
  await screen.findByLabelText('1 unread');
  await open();
  await screen.findByRole('link', { name: 'You were mentioned' });
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  await waitFor(() => expect(notificationApi.read).toHaveBeenCalledWith('n'));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Notifications' }),
  );
});
it('paginates, changes filters and marks a bounded snapshot', async () => {
  jest
    .mocked(notificationApi.list)
    .mockImplementation(async (cursor, unread, type, limit) =>
      limit === 1
        ? page
        : cursor
          ? {
              ...page,
              items: [{ ...item, id: 'older', type: 'COMMENT', readAt: date }],
              nextCursor: null,
            }
          : { ...page, nextCursor: 'cursor', items: [item] },
    );
  setup();
  await open();
  await screen.findByRole('button', { name: 'Load more' });
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('Read');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Newest' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Newest' }));
  await waitFor(() => expect(screen.queryByText('Read')).toBeNull());
  fireEvent.click(screen.getByLabelText('Unread only'));
  await waitFor(() => expect(notificationApi.list).toHaveBeenCalledWith(null, true, ''));
  fireEvent.change(screen.getByLabelText('Event type'), { target: { value: 'MENTION' } });
  await waitFor(() =>
    expect(notificationApi.list).toHaveBeenCalledWith(null, true, 'MENTION'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mark up to 100 as read' }));
  await waitFor(() => expect(notificationApi.readAll).toHaveBeenCalledWith(date));
});
it('navigates to the protected target and acknowledges unread rows', async () => {
  setup(false);
  await open();
  fireEvent.click(await screen.findByRole('link', { name: 'You were mentioned' }));
  await waitFor(() => expect(notificationApi.read).toHaveBeenCalledWith('n'));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens read rows without a redundant read and caps the badge', async () => {
  jest.mocked(notificationApi.list).mockResolvedValue({
    ...page,
    countCapped: true,
    unreadCount: 1000,
    items: [{ ...item, readAt: date }],
  });
  setup(false);
  await screen.findByText('1000+');
  await open();
  fireEvent.click(await screen.findByRole('link', { name: 'You were mentioned' }));
  expect(notificationApi.read).not.toHaveBeenCalled();
});
it('shows loading, empty and zero badge states', async () => {
  let resolve!: (value: NotificationPage) => void;
  jest.mocked(notificationApi.list).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  setup(false);
  await open();
  expect(screen.getByText('Loading…')).toBeTruthy();
  await act(async () => resolve({ ...page, items: [], unreadCount: 0 }));
  await screen.findByText('No notifications.');
  expect(
    screen
      .getByRole('button', { name: 'Mark up to 100 as read' })
      .hasAttribute('disabled'),
  ).toBe(true);
});
it('hides cached feed data on authorization errors and allows retry', async () => {
  setup(false);
  await open();
  await screen.findByRole('link', { name: 'You were mentioned' });
  jest.mocked(notificationApi.list).mockRejectedValue(new Error('Access revoked'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['notifications', 'u'] });
  });
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'You were mentioned' })).toBeNull(),
  );
  expect(screen.getByRole('alert').textContent).toContain('Notifications unavailable');
  expect(screen.getByTitle('Notifications unavailable.')).toBeTruthy();
  jest.mocked(notificationApi.list).mockResolvedValue(page);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('link', { name: 'You were mentioned' });
});
it('surfaces mutation failure and stores workspace mute settings', async () => {
  jest
    .mocked(notificationApi.preferences)
    .mockResolvedValue([{ type: 'MENTION', muted: true }]);
  jest.mocked(notificationApi.read).mockRejectedValue(new Error('read failed'));
  setup();
  await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as read' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Mute future events in this workspace'));
  const checkbox = await screen.findByRole('checkbox', { name: 'You were mentioned' });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(notificationApi.mute).toHaveBeenCalledWith('w', 'MENTION', false),
  );
});
it('shows preference loading and failures', async () => {
  jest
    .mocked(notificationApi.preferences)
    .mockRejectedValue(new Error('preferences failed'));
  setup();
  await open();
  fireEvent.click(screen.getByText('Mute future events in this workspace'));
  await screen.findByRole('alert');
});
