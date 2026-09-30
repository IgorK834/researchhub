/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { SourceExtractionPreview } from './SourceExtractionPreview';

const originalFetch = globalThis.fetch;
const extraction = {
  parserVersion: 'pypdf-6.14.2/rh-1',
  warnings: ['OCR_REQUIRED: Page 2 needs OCR'],
  workbook: null,
  chunks: [
    {
      chunkId: 'p1',
      ordinal: 0,
      sourceId: 's1',
      pageNumber: 1,
      text: 'Lecture content',
      location: null,
    },
    {
      chunkId: 'p2',
      ordinal: 1,
      sourceId: 's1',
      pageNumber: 2,
      text: '',
      location: null,
    },
  ],
};
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}
function show(body: unknown, status = 200): void {
  globalThis.fetch = jest.fn(() => Promise.resolve(response(body, status)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SourceExtractionPreview workspaceId="w1" sourceId="s1" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  globalThis.fetch = originalFetch;
});
it('loads page text with source identity and an OCR warning through the scoped API', async () => {
  show(extraction);
  expect(screen.getByRole('status').textContent).toBe('Loading extracted content…');
  expect(
    await screen.findByRole('heading', { name: 'Extracted content' }),
  ).not.toBeNull();
  expect(screen.getByText('Page 1')).not.toBeNull();
  expect(screen.getByText('Page 2')).not.toBeNull();
  expect(screen.getByText('Lecture content')).not.toBeNull();
  expect(screen.getByText('(No text extracted)')).not.toBeNull();
  expect(screen.getByText('OCR_REQUIRED: Page 2 needs OCR')).not.toBeNull();
  expect(globalThis.fetch).toHaveBeenCalledWith(
    '/api/workspaces/w1/sources/s1/extraction',
    expect.objectContaining({ method: 'GET' }),
  );
});
it('shows DOCX block locations and renders source text safely', async () => {
  show({
    ...extraction,
    warnings: [],
    chunks: [
      {
        chunkId: 'h',
        ordinal: 0,
        sourceId: 's1',
        pageNumber: null,
        text: 'Theory',
        location: { kind: 'HEADING', blockIndex: 1 },
      },
      {
        chunkId: 't',
        ordinal: 1,
        sourceId: 's1',
        pageNumber: null,
        text: '<script>unsafe()</script>',
        location: { kind: 'TABLE', blockIndex: 2 },
      },
      {
        chunkId: 'p',
        ordinal: 2,
        sourceId: 's1',
        pageNumber: null,
        text: 'Paragraph',
        location: null,
      },
    ],
  });
  expect(await screen.findByText('Block 2 — heading')).not.toBeNull();
  expect(screen.getByText('Block 3 — table')).not.toBeNull();
  expect(screen.getByText('Block 3')).not.toBeNull();
  expect(screen.getByText('<script>unsafe()</script>')).not.toBeNull();
  expect(document.querySelector('script')).toBeNull();
});
it('shows hidden sheets, sample limits and incomplete formula detection', async () => {
  const sheet = {
    name: 'Data',
    state: 'visible',
    usedRange: 'A1:B1000',
    rowCountEstimate: 1000,
    columnCount: 2,
    headerCandidate: ['mass', 'value'],
    headerRow: 1,
    sampledRows: 10,
    truncated: true,
    formulaPresence: true,
    formulaScanComplete: false,
    columns: [
      { columnNumber: 1, values: ['2', '=B2+1'], dataTypes: ['number', 'formula'] },
    ],
  };
  show({
    ...extraction,
    chunks: [
      {
        chunkId: 's',
        ordinal: 0,
        sourceId: 's1',
        pageNumber: null,
        text: '2',
        location: { kind: 'SHEET', sheetName: 'Data', cellRange: 'A1:B10' },
      },
    ],
    workbook: {
      rowLimit: 10,
      columnLimit: 2,
      sampleLimit: 3,
      sheets: [
        sheet,
        {
          ...sheet,
          name: 'Hidden',
          state: 'hidden',
          formulaPresence: null,
          headerCandidate: [],
          headerRow: null,
          usedRange: null,
          rowCountEstimate: null,
          columnCount: null,
        },
        {
          ...sheet,
          name: 'Empty',
          state: 'veryHidden',
          formulaPresence: false,
          formulaScanComplete: true,
          truncated: false,
        },
      ],
    },
  });
  expect(await screen.findByText('Hidden (hidden)')).not.toBeNull();
  expect(screen.getByText('Empty (veryHidden)')).not.toBeNull();
  expect(screen.getByText(/Unknown outside the sample/)).not.toBeNull();
  expect(screen.getByText(/Formulas: Present/)).not.toBeNull();
  expect(screen.getByText(/Formulas: Absent/)).not.toBeNull();
  expect(screen.getByText(/Header candidate: None/)).not.toBeNull();
  expect(screen.getAllByText('number, formula')).toHaveLength(3);
  expect(screen.getByText('Source: s1 · A1:B10')).not.toBeNull();
});
it('handles content that is not yet published', async () => {
  show(undefined, 204);
  expect(
    await screen.findByText('Extracted content is not available yet.'),
  ).not.toBeNull();
});
it('retries a failed preview request', async () => {
  show({ title: 'Error', detail: 'Unavailable', status: 503 }, 503);
  expect(await screen.findByRole('alert')).not.toBeNull();
  globalThis.fetch = jest.fn(() => Promise.resolve(response(extraction)));
  fireEvent.click(screen.getByRole('button', { name: 'Retry extraction preview' }));
  expect(
    await screen.findByRole('heading', { name: 'Extracted content' }),
  ).not.toBeNull();
});
