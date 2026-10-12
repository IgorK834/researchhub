/** @jest-environment jsdom */
import { apiClient } from '../../../shared/api';
import { primeCsrfToken } from './authApi';
import * as api from './accountDataApi';
jest.mock('./authApi', () => ({
  primeCsrfToken: jest.fn().mockResolvedValue(undefined),
}));
const receipt: api.ErasureReceipt = {
  jobId: 'j',
  receipt: 'private-receipt',
  status: 'PENDING',
  policyVersion: 'v1',
  backupStatus: 'OUTSIDE_LIVE_STORE_SCOPE',
};
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: undefined,
    writable: true,
  });
});
it('confirms with CSRF and polls only the opaque receipt', async () => {
  jest.spyOn(apiClient, 'delete').mockResolvedValue(receipt);
  jest.spyOn(apiClient, 'get').mockResolvedValue({ status: 'PENDING' });
  expect(await api.deleteAccount('password')).toEqual(receipt);
  expect(primeCsrfToken).toHaveBeenCalled();
  expect(apiClient.delete).toHaveBeenCalledWith('/api/account', {
    body: { password: 'password' },
  });
  const signal = new AbortController().signal;
  await api.fetchErasureStatus(receipt, signal);
  expect(apiClient.get).toHaveBeenCalledWith('/api/account/deletions/j', {
    headers: { 'X-Erasure-Receipt': 'private-receipt' },
    signal,
  });
});
it('downloads personal JSON and releases temporary URLs', async () => {
  jest.spyOn(apiClient, 'getBlob').mockResolvedValue(new Blob(['{}']));
  URL.createObjectURL = jest.fn(() => 'blob:personal');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await api.downloadAccountData();
  expect(apiClient.getBlob).toHaveBeenCalledWith('/api/account/export', {
    accept: 'application/json',
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:personal');
});
it('propagates failed exports', async () => {
  jest.spyOn(apiClient, 'getBlob').mockRejectedValue(new Error('Unavailable'));
  await expect(api.downloadAccountData()).rejects.toThrow('Unavailable');
});
it('clears only ResearchHub databases and handles blocked or unavailable browser storage', async () => {
  expect(await api.clearResearchhubOfflineData()).toBe(false);
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: {},
  });
  expect(await api.clearResearchhubOfflineData()).toBe(false);
  const databases = jest
    .fn()
    .mockResolvedValue([
      { name: 'researchhub:w:d:epoch:1' },
      { name: 'other-app' },
      { name: undefined },
    ]);
  const deleteDatabase = jest.fn(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => request.onsuccess?.(new Event('success') as never));
    return request;
  });
  globalThis.indexedDB = { databases, deleteDatabase } as unknown as IDBFactory;
  expect(await api.clearResearchhubOfflineData()).toBe(true);
  expect(deleteDatabase).toHaveBeenCalledTimes(1);
  expect(deleteDatabase).toHaveBeenCalledWith('researchhub:w:d:epoch:1');
  for (const outcome of ['onblocked', 'onerror'] as const) {
    deleteDatabase.mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => request[outcome]?.(new Event('error') as never));
      return request;
    });
    expect(await api.clearResearchhubOfflineData()).toBe(false);
  }
  databases.mockRejectedValueOnce(new Error('Unavailable'));
  expect(await api.clearResearchhubOfflineData()).toBe(false);
});
