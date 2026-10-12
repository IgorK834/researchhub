/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../api/governanceApi';
import { WorkspaceGovernance } from './WorkspaceGovernance';
jest.mock('../api/governanceApi');
const summary: api.AiUsageSummary = {
  from: '2026-10-01T00:00:00Z',
  to: '2026-10-12T00:00:00Z',
  features: [
    {
      feature: 'REWRITE',
      requests: 3,
      failures: 1,
      usageKnown: 2,
      inputTokens: 12,
      outputTokens: 5,
    },
    {
      feature: 'SOURCE_ANALYSIS',
      requests: 1,
      failures: 1,
      usageKnown: 0,
      inputTokens: null,
      outputTokens: null,
    },
  ],
  quotas: [{ category: 'LLM', requests: 5, limit: 60, resetsAt: '2026-10-12T12:01:00Z' }],
};
beforeEach(() => {
  jest.mocked(api.fetchAiUsage).mockResolvedValue(summary);
  jest.mocked(api.downloadAudit).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  jest.resetAllMocks();
});
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <WorkspaceGovernance workspaceId="w" />
    </QueryClientProvider>,
  );
}
it('shows feature totals, unknown usage and real quotas and changes the window', async () => {
  mount();
  expect(screen.getByRole('status').textContent).toContain('Loading');
  await screen.findByText('REWRITE');
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByText(/LLM: 5 \/ 60/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Usage window'), { target: { value: '7' } });
  await waitFor(() =>
    expect(api.fetchAiUsage).toHaveBeenLastCalledWith('w', 7, expect.any(AbortSignal)),
  );
});
it.each(['csv', 'json'] as const)(
  'downloads %s through the authenticated API',
  async (format) => {
    mount();
    await screen.findByText('REWRITE');
    fireEvent.click(
      screen.getByRole('button', { name: `Export ${format.toUpperCase()}` }),
    );
    await waitFor(() => expect(api.downloadAudit).toHaveBeenCalledWith('w', format));
  },
);
it('shows empty, loading, failure and retry states', async () => {
  jest.mocked(api.fetchAiUsage).mockResolvedValueOnce({ ...summary, features: [] });
  mount();
  await screen.findByText('No AI requests in this window.');
  cleanup();
  jest.mocked(api.fetchAiUsage).mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('Could not load AI usage');
  cleanup();
  jest.mocked(api.downloadAudit).mockRejectedValueOnce(new Error('Limit'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  await screen.findByText(/Could not export audit/);
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  await waitFor(() => expect(api.downloadAudit).toHaveBeenCalledTimes(2));
});
it('disables export controls while downloading', async () => {
  jest.mocked(api.downloadAudit).mockImplementation(() => new Promise(() => {}));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await screen.findByText('Preparing audit export…');
  expect(
    (screen.getByRole('button', { name: 'Export JSON' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
