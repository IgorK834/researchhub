/** @jest-environment jsdom */
import * as account from './accountApi';
import * as invitations from '../../workspaces/api/invitationApi';
import { apiClient } from '../../../shared/api';
import { primeCsrfToken } from './authApi';
jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('./authApi', () => ({
  primeCsrfToken: jest.fn().mockResolvedValue(undefined),
}));
const client = jest.mocked(apiClient);
it('uses shared transport and CSRF for every account and invitation mutation and cancels reads', async () => {
  const signal = new AbortController().signal;
  await account.listSessions(signal);
  expect(client.get).toHaveBeenLastCalledWith('/api/auth/sessions', { signal });
  document.cookie = 'XSRF-TOKEN=session-csrf; Path=/';
  await account.listSessions();
  expect(client.get).toHaveBeenLastCalledWith('/api/auth/sessions', {
    headers: { 'X-XSRF-TOKEN': 'session-csrf' },
  });
  await account.verificationStatus(signal);
  await account.verificationStatus();
  await invitations.listInvitations('w /1', signal);
  expect(client.get).toHaveBeenLastCalledWith('/api/workspaces/w%20%2F1/invitations', {
    signal,
  });
  await invitations.listInvitations('w1');
  await account.changePassword('old', 'new');
  expect(client.post).toHaveBeenLastCalledWith('/api/auth/password', {
    body: { currentPassword: 'old', newPassword: 'new' },
  });
  await account.revokeSession('opaque /handle');
  expect(client.delete).toHaveBeenLastCalledWith('/api/auth/sessions/opaque%20%2Fhandle');
  await account.revokeAllSessions();
  await account.requestVerification();
  await account.verifyEmail('secret');
  expect(client.post).toHaveBeenLastCalledWith('/api/auth/email-verification/complete', {
    body: { token: 'secret' },
  });
  await account.requestReset('ada@example.test');
  await account.resetPassword('secret', 'new');
  expect(client.post).toHaveBeenLastCalledWith('/api/auth/password-reset/complete', {
    body: { token: 'secret', newPassword: 'new' },
  });
  await invitations.createInvitation('w1', 'ada@example.test', 'EDITOR');
  await invitations.revokeInvitation('w1', 'i /1');
  expect(client.delete).toHaveBeenLastCalledWith(
    '/api/workspaces/w1/invitations/i%20%2F1',
  );
  await invitations.acceptInvitation('secret');
  expect(client.post).toHaveBeenLastCalledWith('/api/invitations/secret/accept');
  expect(primeCsrfToken).toHaveBeenCalledTimes(12);
});
