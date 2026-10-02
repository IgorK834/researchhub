/** @jest-environment jsdom */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import type { DatasetPreview } from '../features/analysis/api/datasetPreviewApi';
import { SourceDetailPage } from './SourceDetailPage';
import csvFixture from '../../../contracts/analysis/dataset-preview/v1/csv-preview.json';

const csv = csvFixture as unknown as DatasetPreview;
const originalFetch = globalThis.fetch;
const base = '/api/workspaces/w-1/sources/s-1';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's-1',
    workspaceId: 'w-1',
    displayName: 'people.csv',
    originalFilename: 'people-rev2.csv',
    sourceType: 'CSV',
    sizeBytes: 2048,
    status: 'READY',
    failureSummary: null,
    uploadedBy: 'u-1',
    createdAt: '2026-09-23T10:15:30Z',
    updatedAt: '2026-09-24T10:15:30Z',
    activeVersionId: 'v2',
    activeVersionNumber: 2,
    ...overrides,
  };
}

function version(id: string, number: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    sourceId: 's-1',
    workspaceId: 'w-1',
    versionNumber: number,
    originalFilename: `people-rev${String(number)}.csv`,
    mediaType: 'text/csv',
    sourceType: 'CSV',
    sizeBytes: 100 * number,
    contentSha256: 'a'.repeat(64),
    status: 'READY',
    failureSummary: null,
    uploadedBy: 'u-1',
    createdAt: `2026-09-2${String(number)}T10:00:00Z`,
    updatedAt: `2026-09-2${String(number)}T10:00:00Z`,
    active: number === 2,
    ...overrides,
  };
}

function Probe(): ReactElement {
  const location = useLocation();
  return <p data-testid="workspace-page">{`${location.pathname}${location.search}`}</p>;
}

function renderPage({
  role = 'EDITOR',
  archivedAt = null,
  sourceBody = source(),
  versions = [version('v2', 2), version('v1', 1)],
  entry = '/app/workspaces/w-1/sources/s-1',
}: {
  role?: string;
  archivedAt?: string | null;
  sourceBody?: Record<string, unknown>;
  versions?: unknown[];
  entry?: string;
} = {}): jest.Mock {
  const fetchMock = jest.fn((url: unknown) => {
    const path = String(url);
    if (path === '/api/workspaces/w-1')
      return Promise.resolve(response({ role, archivedAt }));
    if (path === '/api/me')
      return Promise.resolve(
        response({
          id: 'u-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          status: 'ACTIVE',
        }),
      );
    if (path === '/api/workspaces/w-1/members')
      return Promise.resolve(
        response([{ userId: 'u-1', displayName: 'Ada', role, email: 'ada@example.com' }]),
      );
    if (path === base) return Promise.resolve(response(sourceBody));
    if (path === `${base}/versions`) return Promise.resolve(response(versions));
    if (path === `${base}/extraction`) return Promise.resolve(response(null));
    if (path === `${base}/extraction/runs`) return Promise.resolve(response([]));
    const preview = /\/analysis\/datasets\/s-1\/versions\/([^/]+)\/preview$/.exec(path);
    if (preview !== null) {
      const id = preview[1] ?? '';
      return Promise.resolve(
        response({
          ...csv,
          sourceId: 's-1',
          sourceVersionId: id,
          versionNumber: id === 'v1' ? 1 : 2,
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected request ${path}`));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/app/workspaces/:workspaceId/sources/:sourceId"
            element={children}
          />
          <Route path="/app/workspaces/:workspaceId" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<SourceDetailPage />, { wrapper });
  return fetchMock;
}

function requested(fetchMock: jest.Mock, path: string): boolean {
  return fetchMock.mock.calls.some((call) => String(call[0]) === path);
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

it('previews the latest version, lists every version and offers a replacement to editors', async () => {
  const fetchMock = renderPage();

  expect(await screen.findByRole('heading', { name: 'people.csv' })).not.toBeNull();
  // Once in the page's own metadata and once in the preview's source header.
  expect(screen.getAllByText('2 (latest)', { selector: 'dd' })).toHaveLength(2);
  expect(await screen.findByRole('heading', { name: 'Dataset preview' })).not.toBeNull();
  expect(
    requested(fetchMock, '/api/workspaces/w-1/analysis/datasets/s-1/versions/v2/preview'),
  ).toBe(true);
  expect(
    requested(fetchMock, '/api/workspaces/w-1/analysis/datasets/s-1/versions/v1/preview'),
  ).toBe(false);

  const history = await screen.findByRole('table', { name: 'Source versions' });
  expect(within(history).getAllByRole('row')).toHaveLength(3);
  expect(screen.getByRole('heading', { name: 'Upload a new version' })).not.toBeNull();
});

it('hides the replacement form from viewers and while the source is still being processed', async () => {
  renderPage({ role: 'VIEWER' });
  await screen.findByRole('table', { name: 'Source versions' });
  expect(screen.queryByRole('heading', { name: 'Upload a new version' })).toBeNull();
  cleanup();

  renderPage({
    sourceBody: source({ status: 'PROCESSING' }),
    versions: [version('v2', 2, { status: 'PROCESSING' }), version('v1', 1)],
  });
  await screen.findByRole('table', { name: 'Source versions' });
  expect(screen.queryByRole('heading', { name: 'Upload a new version' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Dataset preview' })).toBeNull();
});

it.each(['OWNER', 'EDITOR', 'VIEWER', 'REVIEWER'])(
  'keeps archived source content readable but omits editing for %s',
  async (role) => {
    renderPage({
      role,
      archivedAt: '2026-10-01T10:00:00Z',
      sourceBody: source({ status: 'FAILED' }),
    });
    await screen.findByRole('table', { name: 'Source versions' });
    expect(screen.getByRole('link', { name: 'Download source' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Upload a new version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprocess source' })).toBeNull();
  },
);

it('previews an older version from the history and refuses to analyze it', async () => {
  const fetchMock = renderPage();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Preview data of version 1' }),
  );

  expect(
    within(await screen.findByLabelText('Source version')).getByText('1 (older version)'),
  ).not.toBeNull();
  expect(
    requested(fetchMock, '/api/workspaces/w-1/analysis/datasets/s-1/versions/v1/preview'),
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Analyze this data' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Preview data of version 1' })
      .getAttribute('aria-pressed'),
  ).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: 'Preview data of version 2' }));
  expect(
    within(await screen.findByLabelText('Source version')).getByText('2 (latest)'),
  ).not.toBeNull();
});

it('restores a version from the URL and ignores one that does not belong to the source', async () => {
  renderPage({ entry: '/app/workspaces/w-1/sources/s-1?version=v1' });
  expect(
    within(await screen.findByLabelText('Source version')).getByText('1 (older version)'),
  ).not.toBeNull();
  cleanup();

  const fetchMock = renderPage({
    entry: '/app/workspaces/w-1/sources/s-1?version=not-mine',
  });
  expect(
    within(await screen.findByLabelText('Source version')).getByText('2 (latest)'),
  ).not.toBeNull();
  expect(
    requested(
      fetchMock,
      '/api/workspaces/w-1/analysis/datasets/s-1/versions/not-mine/preview',
    ),
  ).toBe(false);
});

it('"Analyze this data" opens the workspace questions scoped to this source and sheet', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Analyze this data' }));

  expect((await screen.findByTestId('workspace-page')).textContent).toBe(
    '/app/workspaces/w-1?analyzeSource=s-1&analyzeVersion=v2&analyzeSheet=CSV',
  );
});

it('shows no data preview for a document source', async () => {
  renderPage({
    sourceBody: source({ displayName: 'Lecture.pdf', sourceType: 'PDF' }),
    versions: [version('v2', 2, { sourceType: 'PDF', mediaType: 'application/pdf' })],
  });
  await screen.findByRole('heading', { name: 'Lecture.pdf' });
  await screen.findByRole('table', { name: 'Source versions' });
  expect(screen.queryByRole('heading', { name: 'Dataset preview' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Preview data of version/ })).toBeNull();
});
