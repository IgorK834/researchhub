/** @jest-environment jsdom */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { SourceDetailPage } from './SourceDetailPage';

const sourcePath = '/api/workspaces/w-1/sources/s-1';
const originalFetch = globalThis.fetch;

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function renderPage(sourceResponse: Response): void {
  globalThis.fetch = jest.fn((url: unknown) => {
    if (String(url) === sourcePath) return Promise.resolve(sourceResponse);
    if (String(url) === '/api/workspaces/w-1/members') {
      return Promise.resolve(
        response([
          { userId: 'u-1', displayName: 'Ada', role: 'EDITOR', email: 'ada@example.com' },
        ]),
      );
    }
    throw new Error(`Unexpected request ${String(url)}`);
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/workspaces/w-1/sources/s-1']}>
        <Routes>
          <Route
            path="/app/workspaces/:workspaceId/sources/:sourceId"
            element={children}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<SourceDetailPage />, { wrapper });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('shows authorized metadata, uploader, status and a backend download link', async () => {
  renderPage(
    response({
      id: 's-1',
      workspaceId: 'w-1',
      displayName: 'team.csv',
      sourceType: 'CSV',
      sizeBytes: 12,
      status: 'FAILED',
      failureSummary: 'The CSV is malformed.',
      uploadedBy: 'u-1',
      createdAt: '2026-09-23T10:15:30Z',
    }),
  );

  expect(await screen.findByRole('heading', { name: 'team.csv' })).not.toBeNull();
  expect(screen.getByText('Failed')).not.toBeNull();
  expect(screen.getByText('Ada')).not.toBeNull();
  expect(screen.getByText('Failure: The CSV is malformed.')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Download source' }).getAttribute('href')).toBe(
    '/api/workspaces/w-1/sources/s-1/content',
  );
});

it('does not reveal whether a missing source exists in another workspace', async () => {
  renderPage(
    response(
      {
        title: 'Not found',
        detail: 'Not found',
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      },
      404,
    ),
  );

  expect(await screen.findByRole('heading', { name: 'Source not found' })).not.toBeNull();
  expect(screen.queryByRole('link', { name: 'Download source' })).toBeNull();
});
