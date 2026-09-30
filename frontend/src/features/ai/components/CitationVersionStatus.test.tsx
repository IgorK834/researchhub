/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { CitationVersionStatus } from './CitationVersionStatus';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function show(status: number, body: unknown): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CitationVersionStatus workspaceId="w1" sourceId="s1" processingVersion="v1" />
    </QueryClientProvider>,
  );
}
it('checks the citation version using a workspace-scoped query', async () => {
  show(200, { processingVersion: 'v1' });
  expect(screen.getByRole('status').textContent).toContain('Checking');
  await waitFor(() => {
    expect(screen.queryByRole('status')).toBeNull();
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w1/sources/s1/retrieval?processingVersion=v1',
    expect.objectContaining({ method: 'GET' }),
  );
});
it.each([
  [409, { code: 'CONFLICT', detail: 'Changed', status: 409 }],
  [204, undefined],
])('warns for changed or unpublished evidence (%s)', async (status, body) => {
  show(status, body);
  expect((await screen.findByRole('alert')).textContent).toContain(
    'preview below shows the current source',
  );
});
