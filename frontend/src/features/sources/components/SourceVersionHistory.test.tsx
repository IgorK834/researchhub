/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { SourceVersion } from '../api/sourceApi';
import { SourceVersionHistory } from './SourceVersionHistory';

const originalFetch = globalThis.fetch;

function version(overrides: Partial<SourceVersion>): SourceVersion {
  return {
    id: 'v1',
    sourceId: 's',
    workspaceId: 'w',
    versionNumber: 1,
    originalFilename: 'data.csv',
    mediaType: 'text/csv',
    sourceType: 'CSV',
    sizeBytes: 1234,
    contentSha256: 'a'.repeat(64),
    status: 'READY',
    failureSummary: null,
    uploadedBy: 'u',
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
    active: false,
    ...overrides,
  };
}

function reply(body: unknown, status = 200): void {
  globalThis.fetch = jest.fn(() =>
    Promise.resolve({
      ok: status < 400,
      status,
      statusText: '',
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  ) as unknown as typeof fetch;
}

function view(props: Partial<Parameters<typeof SourceVersionHistory>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SourceVersionHistory workspaceId="w" sourceId="s" {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

it('lists every immutable version newest first, with a download link for each', async () => {
  reply([
    version({
      id: 'v2',
      versionNumber: 2,
      originalFilename: 'data-rev2.xlsx',
      sourceType: 'XLSX',
      active: true,
      status: 'PROCESSING',
    }),
    version({ id: 'v1' }),
  ]);
  view();

  const table = await screen.findByRole('table', { name: 'Source versions' });
  expect(screen.getByText(/Existing analyses keep the version they used/)).not.toBeNull();
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0] as HTMLElement).getByRole('rowheader').textContent).toBe(
    '2 (latest)',
  );
  expect(within(rows[0] as HTMLElement).getByText('data-rev2.xlsx')).not.toBeNull();
  expect(within(rows[0] as HTMLElement).getByText('Processing')).not.toBeNull();
  expect(within(rows[1] as HTMLElement).getByText('1,234 bytes')).not.toBeNull();
  expect(within(rows[1] as HTMLElement).getByText('Ready')).not.toBeNull();
  const download = screen.getByRole('link', { name: 'Download version 1' });
  expect(download.getAttribute('href')).toBe(
    '/api/workspaces/w/sources/s/versions/v1/content',
  );
  expect(download.getAttribute('download')).toBe('data.csv');
  expect(
    screen.getByRole('link', { name: 'Download version 2' }).getAttribute('href'),
  ).toBe('/api/workspaces/w/sources/s/versions/v2/content');
});

it('offers a data preview only for ready CSV/XLSX versions and reports the choice', async () => {
  reply([
    version({ id: 'v3', versionNumber: 3, active: true, sourceType: 'XLSX' }),
    version({ id: 'v2', versionNumber: 2, status: 'PROCESSING' }),
    version({ id: 'v1', sourceType: 'PDF', originalFilename: 'paper.pdf' }),
  ]);
  const onPreview = jest.fn();
  view({ onPreview, selectedVersionId: 'v3' });

  await screen.findByRole('table', { name: 'Source versions' });
  const preview = screen.getByRole('button', { name: 'Preview data of version 3' });
  expect(preview.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Preview data of version 2' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview data of version 1' })).toBeNull();
  fireEvent.click(preview);
  expect(onPreview).toHaveBeenCalledWith('v3');
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows[0]?.getAttribute('data-selected')).toBe('true');
  expect(rows[1]?.getAttribute('data-selected')).toBeNull();
});

it('offers no preview action when the page cannot show one', async () => {
  reply([version({ id: 'v1', active: true })]);
  view();
  await screen.findByRole('table', { name: 'Source versions' });
  expect(screen.queryByRole('button')).toBeNull();
});

it('reports loading and failure', async () => {
  reply(
    {
      title: 'Not found',
      detail: 'Source was not found',
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    },
    404,
  );
  view();
  expect(screen.getByRole('status').textContent).toContain('Loading versions');
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load versions',
  );
});
