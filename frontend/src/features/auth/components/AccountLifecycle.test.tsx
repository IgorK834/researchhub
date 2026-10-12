/** @jest-environment jsdom */
import type { ReactElement } from 'react';
import { ApiError } from '../../../shared/api';
function failure(detail: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Error',
    status: 400,
    code: 'VALIDATION_FAILED',
    rawCode: 'VALIDATION_FAILED',
    detail,
  });
}
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AccountSettings } from './AccountSettings';
import { AccountLink } from './AccountLink';
import { PasswordRecovery } from './PasswordRecovery';
import { InvitationPanel } from '../../workspaces/components/InvitationPanel';
import * as api from '../api/accountApi';
import * as invitations from '../../workspaces/api/invitationApi';

jest.mock('../api/accountApi');
jest.mock('../../workspaces/api/invitationApi');
const mockNavigate = jest.fn();
let mockUser: { data: { email: string } | null; isPending: boolean; error: Error | null };
jest.mock('../api/useAuth', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => mockNavigate,
}));
const account = jest.mocked(api);
const invites = jest.mocked(invitations);
const token = 'a'.repeat(43);
const current: api.SessionSummary = {
  handle: 'opaque-current',
  createdAt: '2026-10-12T10:00:00Z',
  lastAccessedAt: '2026-10-12T10:00:00Z',
  userAgent: 'Firefox · Linux',
  current: true,
};
const other = {
  ...current,
  handle: 'opaque-other',
  userAgent: 'Chrome · Windows',
  current: false,
};
function mount(element: ReactElement, path = '/'): QueryClient {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
function change(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { data: { email: 'ada@example.test' }, isPending: false, error: null };
  account.listSessions.mockResolvedValue([current, other]);
  account.verificationStatus.mockResolvedValue({ emailVerifiedAt: null });
  account.changePassword.mockResolvedValue();
  account.revokeSession.mockResolvedValue();
  account.revokeAllSessions.mockResolvedValue();
  account.requestVerification.mockResolvedValue();
  account.verifyEmail.mockResolvedValue();
  account.requestReset.mockResolvedValue();
  account.resetPassword.mockResolvedValue();
  invites.listInvitations.mockResolvedValue([]);
  invites.revokeInvitation.mockResolvedValue();
  invites.acceptInvitation.mockResolvedValue({ workspaceId: 'workspace-1' });
  invites.createInvitation.mockResolvedValue({
    invitation: {
      id: 'i-1',
      email: 'new@example.test',
      role: 'VIEWER',
      expiresAt: '2099-01-01T00:00:00Z',
      acceptedAt: null,
      revokedAt: null,
    },
    invitationPath: '/invitations#secret',
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

it('changes a password after confirmation and clears it, with loading, error and success states', async () => {
  account.changePassword.mockRejectedValueOnce(failure('Wrong current password'));
  mount(<AccountSettings />);
  expect(screen.getByText('Loading sessions…')).not.toBeNull();
  await screen.findByText('Firefox · Linux');
  change('Current password', 'current');
  change('New password', 'new-long-password');
  change('Confirm new password', 'different');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByText('Passwords do not match.')).not.toBeNull();
  expect(account.changePassword).not.toHaveBeenCalled();
  change('Confirm new password', 'new-long-password');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await screen.findByText('Wrong current password');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await screen.findByText('Password changed. Other sessions have been signed out.');
  expect(account.changePassword).toHaveBeenLastCalledWith('current', 'new-long-password');
  expect(screen.getByLabelText('New password')).toHaveProperty('value', '');
});
it('revokes individual sessions, signs out for current and all sessions, and renders empty and retry states', async () => {
  mount(<AccountSettings />);
  await screen.findByText('Chrome · Windows');
  fireEvent.click(screen.getAllByRole('button', { name: 'Revoke session' })[1]!);
  await screen.findByText('Session revoked.');
  expect(account.revokeSession).toHaveBeenCalledWith(other.handle);
  fireEvent.click(screen.getAllByRole('button', { name: 'Revoke session' })[0]!);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  cleanup();
  mockNavigate.mockClear();
  account.listSessions.mockResolvedValue([]);
  mount(<AccountSettings />);
  await screen.findByText('No active sessions.');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out all sessions' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  cleanup();
  account.listSessions.mockRejectedValueOnce(failure('Sessions unavailable'));
  mount(<AccountSettings />);
  await screen.findByText('Sessions unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No active sessions.');
});
it('shows verification status, requests mail and reports failures', async () => {
  mount(<AccountSettings />);
  await screen.findByText('Verify your email before accepting workspace invitations.');
  fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
  await screen.findByText(/Verification link requested/);
  cleanup();
  account.verificationStatus.mockResolvedValue({
    emailVerifiedAt: '2026-10-12T10:00:00Z',
  });
  mount(<AccountSettings />);
  await screen.findByText('Email verified.');
  cleanup();
  account.verificationStatus.mockRejectedValue(failure('Status unavailable'));
  mount(<AccountSettings />);
  await screen.findByText('Status unavailable');
  cleanup();
  account.verificationStatus.mockResolvedValue({ emailVerifiedAt: null });
  account.requestVerification.mockRejectedValueOnce(failure('Mail unavailable'));
  mount(<AccountSettings />);
  await screen.findByText('Verify your email before accepting workspace invitations.');
  fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
  await screen.findByText('Mail unavailable');
});
it('keeps invitation and verification secrets in fragments across anonymous login and registration', async () => {
  mockUser.data = null;
  mount(<AccountLink kind="invite" />, `/invitations#${token}`);
  expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe(
    `/login#invite:${token}`,
  );
  expect(screen.getByRole('link', { name: /Create account/ }).getAttribute('href')).toBe(
    `/register#${token}`,
  );
  cleanup();
  mount(<AccountLink kind="verify" />, `/verify-email#${token}`);
  expect(screen.queryByRole('link', { name: /Create account/ })).toBeNull();
  cleanup();
  mount(<AccountLink kind="invite" />);
  expect(screen.getByText('This link is incomplete.')).not.toBeNull();
  cleanup();
  mockUser.isPending = true;
  mount(<AccountLink kind="invite" />, `/invitations#${token}`);
  expect(screen.getByText('Checking your session…')).not.toBeNull();
  cleanup();
  mockUser.isPending = false;
  mockUser.error = failure('Session unavailable');
  mount(<AccountLink kind="invite" />, `/invitations#${token}`);
  expect(screen.getByText('Session unavailable')).not.toBeNull();
});
it('waits for email verification before accepting and handles an invalid or expired invitation', async () => {
  mount(<AccountLink kind="invite" />, `/invitations#${token}`);
  await screen.findByText('Verify your email first, then return to this invitation.');
  fireEvent.click(screen.getByRole('button', { name: 'Send verification link' }));
  await screen.findByText(/Verification link requested/);
  account.verificationStatus.mockResolvedValue({
    emailVerifiedAt: '2026-10-12T10:00:00Z',
  });
  fireEvent.click(screen.getByRole('button', { name: 'I have verified my email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith('/app/workspaces/workspace-1'),
  );
  cleanup();
  invites.acceptInvitation.mockRejectedValueOnce(
    failure('Invitation is invalid or no longer available'),
  );
  mount(<AccountLink kind="invite" />, `/invitations#${token}`);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText('Invitation is invalid or no longer available');
});
it('verifies email and shows safe server failures', async () => {
  mount(<AccountLink kind="verify" />, `/verify-email#${token}`);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Verify email' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  await screen.findByText(/Email verified. You can return/);
  expect(account.verifyEmail).toHaveBeenCalledWith(token);
  cleanup();
  account.verifyEmail.mockRejectedValueOnce(failure('Link expired'));
  mount(<AccountLink kind="verify" />, `/verify-email#${token}`);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Verify email' })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
  await screen.findByText('Link expired');
});
it('requests password recovery with the generic response and completes reset after matching confirmation', async () => {
  account.requestReset.mockRejectedValueOnce(failure('Try later'));
  mount(<PasswordRecovery />);
  change('Email', 'ada@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await screen.findByText('Try later');
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await screen.findByText('If an account is eligible, a reset link will be sent.');
  cleanup();
  mount(<PasswordRecovery complete />);
  expect(screen.getByText('A password reset link is required.')).not.toBeNull();
  cleanup();
  mount(<PasswordRecovery complete />, `/reset-password#${token}`);
  change('New password', 'new-password-long');
  change('Confirm new password', 'wrong');
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(screen.getByText('Passwords do not match.')).not.toBeNull();
  change('Confirm new password', 'new-password-long');
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await screen.findByText('Password reset. All sessions have been signed out.');
  expect(account.resetPassword).toHaveBeenCalledWith(token, 'new-password-long');
});
it('creates a one-time displayed link, copies it and revokes pending invitations', async () => {
  mount(<InvitationPanel workspaceId="w1" />);
  expect(screen.getByText('Loading invitations…')).not.toBeNull();
  await screen.findByText('No invitations yet.');
  change('Invite email', 'new@example.test');
  fireEvent.change(screen.getByLabelText('Invited role'), {
    target: { value: 'EDITOR' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  const link = await screen.findByLabelText('Invitation link');
  expect(link).toHaveProperty('value', `${window.location.origin}/invitations#secret`);
  expect(invites.createInvitation).toHaveBeenCalledWith(
    'w1',
    'new@example.test',
    'EDITOR',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy invitation link' }));
  await screen.findByText('Link copied.');
  (navigator.clipboard.writeText as jest.Mock).mockRejectedValueOnce(failure('Denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy invitation link' }));
  await screen.findByText(/Could not copy/);
  const row: invitations.Invitation = {
    id: 'i-1',
    email: 'new@example.test',
    role: 'EDITOR',
    expiresAt: '2099-01-01T00:00:00Z',
    acceptedAt: null,
    revokedAt: null,
  };
  invites.listInvitations.mockResolvedValue([
    row,
    { ...row, id: 'i-2', acceptedAt: '2026-01-01' },
    { ...row, id: 'i-3', revokedAt: '2026-01-01' },
    { ...row, id: 'i-4', expiresAt: '2020-01-01' },
  ]);
  cleanup();
  mount(<InvitationPanel workspaceId="w1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke invitation' }));
  await screen.findByText('Invitation revoked.');
  expect(invites.revokeInvitation).toHaveBeenCalledWith('w1', 'i-1');
});
it('reports invitation list and creation failures', async () => {
  invites.listInvitations.mockRejectedValueOnce(failure('Invitations unavailable'));
  mount(<InvitationPanel workspaceId="w1" />);
  await screen.findByText('Invitations unavailable');
  invites.createInvitation.mockRejectedValueOnce(failure('Rate limit exceeded'));
  change('Invite email', 'new@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText('Rate limit exceeded');
});
