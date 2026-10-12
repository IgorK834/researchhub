/** @jest-environment jsdom */
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AccountDataSettings, AccountDeletionReceipt } from './AccountDataSettings';
import * as api from '../api/accountDataApi';
jest.mock('../api/accountDataApi');
const receipt: api.ErasureReceipt = {
  jobId: 'job-1',
  receipt: 'receipt-1',
  status: 'PENDING',
  policyVersion: 'v1',
  backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE',
};
function mount(state?: unknown, path = '/account') {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  cache.setQueryData(['personal'], { email: 'private@example.test' });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path="/account" element={<AccountDataSettings />} />
          <Route path="/account-deletion" element={<AccountDeletionReceipt />} />
          <Route path="/login" element={<p>Sign in page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  jest.mocked(api.downloadAccountData).mockResolvedValue();
  jest.mocked(api.deleteAccount).mockResolvedValue(receipt);
  jest.mocked(api.clearResearchhubOfflineData).mockResolvedValue(true);
  jest.mocked(api.fetchErasureStatus).mockResolvedValue({
    jobId: 'job-1',
    status: 'SUCCEEDED',
    requestedAt: '2026-10-12T12:00:00Z',
    liveErasedAt: '2026-10-12T12:01:00Z',
    attempts: 1,
    errorCode: null,
    backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE',
  });
});
afterEach(() => {
  cleanup();
  jest.resetAllMocks();
});
it('exports data and confirms deletion, clearing identity caches before showing a public receipt', async () => {
  const cache = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Export personal data (JSON)' }));
  await waitFor(() => expect(api.downloadAccountData).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Confirm your password'), {
    target: { value: 'confirmation-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  await screen.findByText('Live-store data erased.');
  expect(api.deleteAccount).toHaveBeenCalledWith('confirmation-password');
  expect(cache.getQueryData(['personal'])).toBeUndefined();
  expect(screen.getByText(/Backups, offline devices/)).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Return to sign in' }));
  await screen.findByText('Sign in page');
});
it('shows export and confirmation errors and clears the password on closing', async () => {
  jest.mocked(api.downloadAccountData).mockRejectedValueOnce(new Error('Unavailable'));
  jest.mocked(api.deleteAccount).mockRejectedValueOnce(new Error('Incorrect password'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Export personal data (JSON)' }));
  await screen.findByText(/Could not export personal data/);
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  fireEvent.change(screen.getByLabelText('Confirm your password'), {
    target: { value: 'bad' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  expect((screen.getByLabelText('Confirm your password') as HTMLInputElement).value).toBe(
    '',
  );
});
it('prevents dismissal while accepting the deletion', async () => {
  jest.mocked(api.deleteAccount).mockImplementation(() => new Promise(() => {}));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  fireEvent.change(screen.getByLabelText('Confirm your password'), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete account' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('handles missing receipts and pending storage retries without requiring an active login', async () => {
  mount(null, '/account-deletion');
  expect(
    screen.getByText('No receipt is available in this browser session.'),
  ).toBeTruthy();
  cleanup();
  jest.mocked(api.fetchErasureStatus).mockResolvedValueOnce({
    jobId: 'job-1',
    status: 'PENDING',
    requestedAt: '2026-10-12T12:00:00Z',
    liveErasedAt: null,
    attempts: 1,
    errorCode: 'STORAGE_ERASURE_PENDING',
    backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE',
  });
  mount({ receipt, offlineCleared: false }, '/account-deletion');
  await screen.findByText(/storage cleanup is being retried/);
  expect(screen.getByRole('alert').textContent).toContain('offline copies');
  cleanup();
  jest.mocked(api.fetchErasureStatus).mockRejectedValueOnce(new Error('Unavailable'));
  mount({ receipt, offlineCleared: true }, '/account-deletion');
  await screen.findByText(/Could not refresh deletion status/);
});
