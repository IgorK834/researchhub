import { apiClient } from '../../../shared/api';
import { CSRF_HEADER_NAME, readCsrfToken } from '../../../shared/api/csrf';
import { primeCsrfToken } from './authApi';

export interface SessionSummary {
  readonly handle: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly userAgent: string;
  readonly current: boolean;
}
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/password', { body: { currentPassword, newPassword } });
}
export async function listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  await primeCsrfToken();
  const csrf = readCsrfToken();
  return apiClient.get('/api/auth/sessions', {
    ...(csrf === null ? {} : { headers: { [CSRF_HEADER_NAME]: csrf } }),
    ...(signal === undefined ? {} : { signal }),
  });
}
export async function revokeSession(handle: string): Promise<void> {
  await primeCsrfToken();
  await apiClient.delete(`/api/auth/sessions/${encodeURIComponent(handle)}`);
}
export async function revokeAllSessions(): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/sessions/revoke-all');
}
export function verificationStatus(
  signal?: AbortSignal,
): Promise<{ emailVerifiedAt: string | null }> {
  return apiClient.get('/api/auth/email-verification', {
    ...(signal === undefined ? {} : { signal }),
  });
}
export async function requestVerification(): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/email-verification/request');
}
export async function verifyEmail(token: string): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/email-verification/complete', { body: { token } });
}
export async function requestReset(email: string): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/password-reset/request', { body: { email } });
}
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await primeCsrfToken();
  await apiClient.post('/api/auth/password-reset/complete', {
    body: { token, newPassword },
  });
}
