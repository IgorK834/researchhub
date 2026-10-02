/** @jest-environment jsdom */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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

function renderPage(
  sourceResponse: Response,
  extraction?: unknown,
  entry = '/app/workspaces/w-1/sources/s-1',
): void {
  globalThis.fetch = jest.fn((url: unknown) => {
    if (String(url) === '/api/workspaces/w-1')
      return Promise.resolve(response({ role: 'EDITOR', archivedAt: null }));
    if (String(url) === '/api/me')
      return Promise.resolve(
        response({
          id: 'u-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          status: 'ACTIVE',
        }),
      );
    if (String(url) === `${sourcePath}/extraction/runs`)
      return Promise.resolve(response([]));
    if (String(url) === sourcePath) return Promise.resolve(sourceResponse);
    if (String(url) === `${sourcePath}/extraction`)
      return Promise.resolve(response(extraction));
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
      <MemoryRouter initialEntries={[entry]}>
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

it('opens the extracted lecture text once the source is ready', async () => {
  renderPage(
    response({
      id: 's-1',
      workspaceId: 'w-1',
      displayName: 'Lecture.pdf',
      sourceType: 'PDF',
      sizeBytes: 1000,
      status: 'READY',
      failureSummary: null,
      uploadedBy: 'u-1',
      createdAt: '2026-09-23T10:15:30Z',
    }),
    {
      parserVersion: 'pypdf-6.14.2/rh-1',
      workbook: null,
      warnings: [],
      chunks: [
        {
          sourceId: 's-1',
          parserVersion: 'pypdf-6.14.2/rh-1',
          chunkId: 'unit-0',
          ordinal: 0,
          text: 'Lecture text',
          pageNumber: 1,
          location: null,
        },
      ],
    },
  );
  expect(
    await screen.findByRole('heading', { name: 'Extracted content' }),
  ).not.toBeNull();
  expect(screen.getAllByText('Page 1')).toHaveLength(2);
  expect(screen.getByText('Lecture text')).not.toBeNull();
});

it('restores a cited PDF page from the URL and updates its source link when navigating', async () => {
  renderPage(
    response({
      id: 's-1',
      workspaceId: 'w-1',
      displayName: 'Lecture.pdf',
      sourceType: 'PDF',
      sizeBytes: 1000,
      status: 'READY',
      failureSummary: null,
      uploadedBy: 'u-1',
      createdAt: '2026-09-23T10:15:30Z',
    }),
    {
      parserVersion: 'parser-1',
      workbook: null,
      warnings: [],
      extractionMetadata: { pageCount: 2 },
      chunks: [1, 2].map((page) => ({
        sourceId: 's-1',
        parserVersion: 'parser-1',
        chunkId: `page-${String(page)}`,
        ordinal: page - 1,
        text: `Lecture ${String(page)}`,
        pageNumber: page,
        location: null,
      })),
    },
    '/app/workspaces/w-1/sources/s-1?unit=page-2&page=2&parserVersion=parser-1',
  );
  expect(await screen.findByText('Page 2 of 2')).not.toBeNull();
  expect(document.getElementById('source-unit-1')?.hasAttribute('open')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous PDF page' }));
  expect(
    screen.getByRole('link', { name: 'Open PDF at page 1' }).getAttribute('href'),
  ).toContain('#page=1');
  expect(document.getElementById('source-unit-0')?.hasAttribute('open')).toBe(true);
  expect(document.getElementById('source-unit-1')?.hasAttribute('open')).toBe(false);
});
