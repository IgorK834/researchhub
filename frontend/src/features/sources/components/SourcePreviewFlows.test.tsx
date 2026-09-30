/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '../../../shared/api';
import { SourceExtractionPreview } from './SourceExtractionPreview';
import { PdfSourcePreview } from './PdfSourcePreview';
import { SourceProcessing } from './SourceProcessing';
import { fetchExtractionRuns, fetchSourceExtraction } from '../api/sourceExtraction';
import { parsePdfPage, pdfPreviewPath, sourceLocationPath } from '../api/sourceLocations';
import type { ExtractedUnit } from '../api/sourceExtraction';

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
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('validates bounded PDF page references and encodes citation locations', () => {
  expect(parsePdfPage(null)).toBe(1);
  expect(parsePdfPage('3', 3)).toBe(3);
  for (const value of ['', '0', '-1', '1.2', '1e2', '10001', '999999999999999999'])
    expect(parsePdfPage(value)).toBeNull();
  expect(parsePdfPage('4', 3)).toBeNull();
  expect(parsePdfPage('4', 0)).toBe(4);
  expect(pdfPreviewPath('w/x', 's', 2)).toBe(
    '/api/workspaces/w%2Fx/sources/s/preview#page=2',
  );
  const unit = {
    chunkId: 'unit&1',
    parserVersion: 'p/1',
    pageNumber: null,
    location: { sheetName: 'a & b' },
  } as ExtractedUnit;
  expect(sourceLocationPath('w', 's', unit)).toBe(
    '/app/workspaces/w/sources/s?unit=unit%261&parserVersion=p%2F1&sheet=a+%26+b',
  );
  expect(
    sourceLocationPath('w', 's', { ...unit, pageNumber: 2, location: null }),
  ).toContain('&page=2');
});

it('opens a deep-linked PDF page and moves within the persisted page count', async () => {
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(response({ extractionMetadata: { pageCount: 3 } })),
  );
  const navigate = jest.fn();
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <PdfSourcePreview
        workspaceId="w"
        sourceId="s"
        ready
        requestedPage="2"
        onNavigate={navigate}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Page 2 of 3')).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'Open PDF at page 2' }).getAttribute('href'),
  ).toContain('#page=2');
  fireEvent.click(screen.getByRole('button', { name: 'Previous PDF page' }));
  expect(navigate).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByRole('button', { name: 'Next PDF page' }));
  expect(navigate).toHaveBeenLastCalledWith(3);
  fireEvent.change(screen.getByLabelText('PDF page'), { target: { value: '1' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Go to page' }).closest('form')!);
  expect(navigate).toHaveBeenLastCalledWith(1);
  fireEvent.change(screen.getByLabelText('PDF page'), { target: { value: '4' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Go to page' }).closest('form')!);
  expect(screen.getByRole('alert')).not.toBeNull();
  view.rerender(
    <QueryClientProvider client={cache}>
      <PdfSourcePreview
        workspaceId="w"
        sourceId="s"
        ready
        requestedPage="3"
        onNavigate={navigate}
      />
    </QueryClientProvider>,
  );
  expect(
    (screen.getByRole('button', { name: 'Next PDF page' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  view.rerender(
    <QueryClientProvider client={cache}>
      <PdfSourcePreview
        workspaceId="w"
        sourceId="s"
        ready
        requestedPage="bad"
        onNavigate={navigate}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('alert')).not.toBeNull();
});

it('allows the original PDF to be opened while extraction is unavailable', () => {
  globalThis.fetch = jest.fn();
  render(
    <QueryClientProvider client={client()}>
      <PdfSourcePreview
        workspaceId="w"
        sourceId="s"
        ready={false}
        requestedPage={null}
        onNavigate={jest.fn()}
      />
    </QueryClientProvider>,
  );
  expect(
    (screen.getByRole('button', { name: 'Previous PDF page' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('reprocesses with CSRF, updates cached status and invalidates old extraction', async () => {
  const cache = client();
  cache.setQueryData(['sources', 'w', 's', 'extraction'], { old: true });
  const invalidate = jest.spyOn(cache, 'invalidateQueries');
  globalThis.fetch = jest.fn((url: unknown) =>
    Promise.resolve(
      response(
        String(url).endsWith('/runs')
          ? [
              {
                jobId: 'j',
                parserVersion: 'parser/1',
                processingVersion: 'source-ingest-3',
                jobStatus: 'SUCCEEDED',
                persistedAt: '2026-09-30T10:00:00Z',
              },
            ]
          : String(url).endsWith('/reprocess')
            ? { id: 's', status: 'PROCESSING' }
            : {},
      ),
    ),
  ) as unknown as typeof fetch;
  render(
    <QueryClientProvider client={cache}>
      <SourceProcessing workspaceId="w" sourceId="s" status="READY" canEdit />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Processing history')).not.toBeNull();
  expect(screen.getByText(/parser\/1/)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reprocess source' }));
  await waitFor(() =>
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/workspaces/w/sources/s/reprocess',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  await waitFor(() =>
    expect(cache.getQueryData(['sources', 'w', 's'])).toEqual({
      id: 's',
      status: 'PROCESSING',
    }),
  );
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/auth/csrf',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(invalidate).toHaveBeenCalledWith(
    expect.objectContaining({ refetchType: 'none' }),
  );
});

it('shows safe history and mutation errors and respects busy and reader states', async () => {
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(response({ status: 503, detail: 'Unavailable' }, 503)),
  );
  const cache = client();
  const view = render(
    <QueryClientProvider client={cache}>
      <SourceProcessing workspaceId="w" sourceId="s" status="FAILED" canEdit />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Could not load processing history/)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reprocess source' }));
  expect(await screen.findByText(/Could not reprocess source/)).not.toBeNull();
  view.rerender(
    <QueryClientProvider client={cache}>
      <SourceProcessing workspaceId="w" sourceId="s" status="PROCESSING" canEdit />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('status')).not.toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Reprocess source' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.rerender(
    <QueryClientProvider client={cache}>
      <SourceProcessing workspaceId="w" sourceId="s" status="UPLOADED" canEdit={false} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Reprocess source' })).toBeNull();
});

it('supports explicit abort signals and absent persisted output in public read clients', async () => {
  globalThis.fetch = jest.fn(() => Promise.resolve(response(undefined, 204)));
  expect(await fetchSourceExtraction('w', 's')).toBeNull();
  await fetchExtractionRuns('w', 's');
  const controller = new AbortController();
  await fetchExtractionRuns('w', 's', controller.signal);
  expect(globalThis.fetch).toHaveBeenLastCalledWith(
    '/api/workspaces/w/sources/s/extraction/runs',
    expect.objectContaining({ signal: controller.signal }),
  );
});

it('loads the new extraction revision without displaying cached text from an earlier run', async () => {
  const cache = client();
  const old = {
    parserVersion: 'old',
    chunks: [
      {
        chunkId: 'old',
        sourceId: 's',
        ordinal: 0,
        text: 'Old cached output',
        pageNumber: null,
        location: null,
      },
    ],
    warnings: [],
    workbook: null,
  };
  cache.setQueryData(queryKeys.sourceExtraction('w', 's', 'earlier'), old);
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(
      response({
        ...old,
        parserVersion: 'new',
        chunks: [{ ...old.chunks[0], text: 'Fresh persisted output' }],
      }),
    ),
  );
  render(
    <QueryClientProvider client={cache}>
      <SourceExtractionPreview workspaceId="w" sourceId="s" revision="later" />
    </QueryClientProvider>,
  );
  expect(screen.queryByText('Old cached output')).toBeNull();
  expect(await screen.findByText('Fresh persisted output')).not.toBeNull();
  expect(cache.getQueryData(queryKeys.sourceExtraction('w', 's', 'earlier'))).toEqual(
    old,
  );
});

it('shows the server stage and coarse progress while processing a source', async () => {
  globalThis.fetch = jest.fn(() =>
    Promise.resolve(
      response({
        jobId: 'job',
        status: 'RUNNING',
        stage: 'EMBED',
        progress: 50,
        attempt: 1,
      }),
    ),
  );
  render(
    <QueryClientProvider client={client()}>
      <SourceProcessing workspaceId="w" sourceId="s" status="PROCESSING" canEdit />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Making source searchable · 50%')).not.toBeNull();
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('50');
  expect(
    screen.getByRole('button', { name: 'Reprocess source' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w/sources/s/processing',
    expect.anything(),
  );
});
