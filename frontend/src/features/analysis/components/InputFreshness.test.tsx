/** @jest-environment jsdom */
import { semanticAnalysis } from '../testing/semanticFixtures';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InputFreshness, EmbeddedInputFreshness } from './InputFreshness';
import { fetchAnalysis } from '../api/analysisApi';
import { setLocale } from '../../../shared/i18n';
jest.mock('../api/analysisApi');
afterEach(() => {
  cleanup();
  jest.resetAllMocks();
});
it('renders original/newest versions and unavailable metadata without source details', () => {
  setLocale('en');
  const { rerender } = render(<InputFreshness />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(
    <InputFreshness staleness={{ stale: false, staleReasons: [], changedInputs: [] }} />,
  );
  expect(screen.queryByRole('status')).toBeNull();
  rerender(
    <InputFreshness
      staleness={{
        stale: true,
        staleReasons: ['SOURCE_REPLACED'],
        changedInputs: [
          {
            sourceId: 's',
            reason: 'SOURCE_REPLACED',
            originalVersion: { id: 'v1', number: 1, sha256: 'hash' },
            currentVersion: { id: 'v2', number: 2, sha256: 'hash' },
          },
          {
            sourceId: 'unavailable',
            reason: 'INPUT_UNAVAILABLE',
            originalVersion: null,
            currentVersion: null,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Original inputs: 1/)).toBeTruthy();
  expect(screen.getByText(/Input unavailable/)).toBeTruthy();
  expect(screen.queryByText('hash')).toBeNull();
});
it('loads embedded state independently of the immutable document output', async () => {
  jest.mocked(fetchAnalysis).mockResolvedValue({
    ...semanticAnalysis(),
    staleness: { stale: true, staleReasons: [], changedInputs: [] },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmbeddedInputFreshness workspaceId="w" analysisId="a" />
    </QueryClientProvider>,
  );
  await screen.findByText('Older inputs');
  expect(fetchAnalysis).toHaveBeenCalledWith('w', 'a');
  client.clear();
});
it('reports unauthorized embedded state', async () => {
  jest.mocked(fetchAnalysis).mockRejectedValue(new Error('forbidden'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmbeddedInputFreshness workspaceId="w" analysisId="a" />
    </QueryClientProvider>,
  );
  await screen.findByText(/Source freshness could not be checked/);
  client.clear();
});
