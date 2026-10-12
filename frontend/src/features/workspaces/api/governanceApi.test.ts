/** @jest-environment jsdom */
import { apiClient } from '../../../shared/api';
import { fetchAiUsage, downloadAudit } from './governanceApi';
afterEach(() => jest.restoreAllMocks());
it('uses a scoped bounded summary contract', async () => {
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue({ features: [] });
  const signal = new AbortController().signal;
  await fetchAiUsage('w /', 7, signal);
  expect(get).toHaveBeenCalledWith('/api/workspaces/w%20%2F/ai/usage?days=7', { signal });
});
it.each(['csv', 'json'] as const)(
  'downloads %s and always releases its URL',
  async (format) => {
    jest.spyOn(apiClient, 'getBlob').mockResolvedValue(new Blob(['data']));
    URL.createObjectURL = jest.fn(() => 'blob:audit');
    URL.revokeObjectURL = jest.fn();
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await downloadAudit('w', format);
    expect(apiClient.getBlob).toHaveBeenCalledWith(
      `/api/workspaces/w/audit/export?format=${format}`,
      { accept: format === 'csv' ? 'text/csv' : 'application/json' },
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audit');
  },
);
it('propagates authorization and download failures', async () => {
  jest.spyOn(apiClient, 'getBlob').mockRejectedValue(new Error('Denied'));
  await expect(downloadAudit('w', 'csv')).rejects.toThrow('Denied');
});
