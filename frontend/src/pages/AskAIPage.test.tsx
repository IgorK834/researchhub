/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskAIPage } from './AskAIPage';
import * as api from '../features/ai/api/conversationApi';
import { useSourcesQuery } from '../features/sources/api/useSources';
import type { WorkspaceSource } from '../features/sources/api/sourceApi';
jest.mock('../features/ai/api/conversationApi');
jest.mock('../features/sources/api/useSources');
jest.mock('../features/ai/components/SourceComparisonPanel', () => ({
  SourceComparisonPanel: ({ workspaceId }: { workspaceId: string }) => (
    <p>Comparison for {workspaceId}</p>
  ),
}));
const sources = jest.mocked(useSourcesQuery);
function setup(props: Partial<Parameters<typeof AskAIPage>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AskAIPage workspaceId="w1" {...props} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.fetchConversations).mockResolvedValue({ items: [], nextOffset: null });
  sources.mockReturnValue({
    data: [
      {
        id: 's1',
        displayName: 'Measures',
        sourceType: 'CSV',
        status: 'READY',
      } as WorkspaceSource,
    ],
    error: null,
    isPending: false,
  } as unknown as ReturnType<typeof useSourcesQuery>);
});
it('composes the conversation page and keeps the existing comparison available in a shared dialog', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Ask AI', level: 1 });
  expect(screen.getByRole('navigation', { name: 'Investigations' })).toBeTruthy();
  expect(screen.queryByText('Comparison for w1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Compare sources' }));
  expect(screen.getByRole('dialog', { name: 'Compare sources' })).toBeTruthy();
  expect(screen.getByText('Comparison for w1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([null, 'CSV', 'Measurements'])(
  'prefills and focuses the dataset question for sheet %s',
  async (sheetName) => {
    setup({ focus: { sourceId: 's1', sheetName } });
    const question = screen.getByLabelText('Research question');
    expect(question).toHaveProperty(
      'value',
      expect.stringContaining('Describe the columns'),
    );
    if (sheetName === 'Measurements')
      expect(question).toHaveProperty(
        'value',
        expect.stringContaining('"Measurements" sheet'),
      );
    expect(document.activeElement).toBe(question);
    await waitFor(() =>
      expect(screen.getByLabelText('Measures')).toHaveProperty('checked', true),
    );
  },
);
it('fails closed while the library cannot be read', async () => {
  sources.mockReturnValue({
    data: undefined,
    error: new Error('No access'),
    isPending: false,
  } as unknown as ReturnType<typeof useSourcesQuery>);
  setup({ initialSourceId: 'unknown' });
  expect(screen.getByRole('button', { name: 'Ask research question' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.queryByText('Measures')).toBeNull();
});
