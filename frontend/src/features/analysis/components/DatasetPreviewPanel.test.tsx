/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { DatasetPreview } from '../api/datasetPreviewApi';
import { DatasetPreviewPanel } from './DatasetPreviewPanel';
import csvFixture from '../../../../../contracts/analysis/dataset-preview/v1/csv-preview.json';
import largeFixture from '../../../../../contracts/analysis/dataset-preview/v1/large-preview.json';
import xlsxFixture from '../../../../../contracts/analysis/dataset-preview/v1/xlsx-preview.json';

const csv = csvFixture as unknown as DatasetPreview;
const xlsx = xlsxFixture as unknown as DatasetPreview;
const large = largeFixture as unknown as DatasetPreview;
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

function problem(status: number, code: string): Response {
  return response({ title: code, detail: `${code} detail`, status, code }, status);
}

function mockFetch(reply: () => Response): jest.Mock {
  const mock = jest.fn(() => Promise.resolve(reply()));
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function panel(
  props: Partial<Parameters<typeof DatasetPreviewPanel>[0]> = {},
  queryClient: QueryClient = client(),
): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <DatasetPreviewPanel workspaceId="w" sourceId="s" sourceVersionId="v" {...props} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

it('shows the source header, counts, column types and a data-only sample for a CSV', async () => {
  const fetchMock = mockFetch(() => response(csv));
  render(panel());

  expect(screen.getByRole('status').textContent).toContain('Loading dataset preview');
  expect(await screen.findByRole('heading', { name: 'Dataset preview' })).not.toBeNull();
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
    '/api/workspaces/w/analysis/datasets/s/versions/v/preview',
  );

  expect(screen.getByText('people.csv')).not.toBeNull();
  expect(screen.getByText('CSV')).not.toBeNull();
  expect(screen.getByText('2 (latest)')).not.toBeNull();
  expect(screen.getByText('2,048 bytes')).not.toBeNull();
  expect(screen.getByTitle(csv.contentSha256).textContent).toBe('abababababab…');

  const sizes = screen.getByLabelText('Sheet size');
  expect(within(sizes).getByText('Data rows').nextElementSibling?.textContent).toBe('2');
  expect(within(sizes).getByText('Columns').nextElementSibling?.textContent).toBe('4');
  expect(within(sizes).getByText('Header row').nextElementSibling?.textContent).toBe('1');
  expect(within(sizes).queryByText('Used range')).toBeNull();

  const types = screen.getByRole('table', { name: 'CSV column types' });
  expect(within(types).getByText('integer')).not.toBeNull();
  expect(within(types).getByText('boolean')).not.toBeNull();
  expect(within(types).getByText('1 of 2')).not.toBeNull();
  expect(within(types).getAllByText('unknown')).toHaveLength(1);

  const sample = screen.getByRole('table', { name: 'CSV dataset preview' });
  expect(within(sample).getByText('Sample rows (2 of 2)')).not.toBeNull();
  expect(
    within(sample)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Row', 'name', 'age', 'active', 'missing']);
  const rows = within(sample).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0] as HTMLElement).getByText('Ada')).not.toBeNull();
  expect(within(rows[0] as HTMLElement).getByRole('rowheader').textContent).toBe('2');
  // The preview is complete and exact, so there is no truncation notice and no analyze button without a handler.
  expect(screen.queryByLabelText('Preview limits')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Analyze this data' })).toBeNull();
  expect(screen.queryByLabelText('Sheet')).toBeNull();
  expect(
    screen.getByText(/Formulas are shown as text and are never calculated/),
  ).not.toBeNull();
});

it('lists every sheet, labels hidden ones, defaults to the first visible sheet and shows formulas as text', async () => {
  mockFetch(() => response(xlsx));
  render(panel());

  const selector = (await screen.findByLabelText('Sheet')) as HTMLSelectElement;
  expect(selector.value).toBe('Measurements');
  expect(Array.from(selector.options).map((option) => option.textContent)).toEqual([
    'Measurements',
    'Hidden (hidden)',
    'Internal (very hidden)',
    'Empty',
  ]);
  expect(screen.getByText('A1:E6')).not.toBeNull();
  expect(screen.getAllByText('=B2*2', { selector: 'td' })).toHaveLength(5);
  const types = screen.getByRole('table', { name: 'Measurements column types' });
  expect(within(types).getByText('formula (text)')).not.toBeNull();
  expect(within(types).getByText('number')).not.toBeNull();
  expect(within(types).getAllByText('date')).toHaveLength(2); // the column's name and its type
  expect(screen.getByLabelText('Notes about this preview').textContent).toContain(
    'Column types are inferred from a bounded sample',
  );

  fireEvent.change(selector, { target: { value: 'Hidden' } });
  expect(screen.getByRole('table', { name: 'Hidden column types' })).not.toBeNull();
  expect(screen.getByText('No sample rows are available for this sheet.')).not.toBeNull();
  fireEvent.change(selector, { target: { value: 'Empty' } });
  expect(screen.getByText('none')).not.toBeNull();
  expect(screen.getByText('0')).not.toBeNull();
});

it('names every truncation, estimate and unknown count instead of passing a sample off as the whole file', async () => {
  mockFetch(() => response(large));
  render(panel());

  const limits = await screen.findByLabelText('Preview limits');
  expect(limits.textContent).toContain('This preview is truncated.');
  expect(limits.textContent).toContain(
    'The workbook has 12 sheets; only the first 10 are listed.',
  );
  expect(limits.textContent).toContain('Wide: Showing the first 3 of 4999 data rows.');
  expect(limits.textContent).toContain('Wide: Showing the first 10 of 120 columns.');
  expect(limits.textContent).toContain('Values longer than 96 bytes were shortened.');

  const sizes = screen.getByLabelText('Sheet size');
  expect(within(sizes).getByText('Data rows').nextElementSibling?.textContent).toBe(
    'about 4,999',
  );
  expect(within(sizes).getByText('Columns').nextElementSibling?.textContent).toBe(
    '10 of 120 shown',
  );
  expect(screen.getByText('Sample rows (3 of about 4,999)')).not.toBeNull();
  expect(screen.getByLabelText('Notes about this preview').textContent).toContain(
    "The row count is an estimate from the file's declared dimensions.",
  );

  fireEvent.change(screen.getByLabelText('Sheet'), { target: { value: 'Unknown' } });
  expect(screen.getByText('unknown (the first 12 rows were scanned)')).not.toBeNull();
  expect(screen.getByLabelText('Notes about this preview').textContent).toContain(
    'The total row count is unknown; at least 12 rows were scanned.',
  );
  expect(screen.getByText(/^Sample rows \(10\)$/)).not.toBeNull();
});

it('renders hostile cell text as inert text', async () => {
  const hostile: DatasetPreview = {
    ...csv,
    sheets: [
      {
        ...(csv.sheets[0] as DatasetPreview['sheets'][number]),
        columns: [
          {
            index: 1,
            name: '<img src=x onerror=alert(1)>',
            inferredType: 'TEXT',
            missingValues: 0,
            profiledValues: 1,
            missingValuesExact: true,
          },
        ],
        sampleRows: [{ rowNumber: 2, cells: ['<script>steal()</script>'] }],
      },
    ],
  };
  mockFetch(() => response(hostile));
  const { container } = render(panel());

  expect(await screen.findByText('<script>steal()</script>')).not.toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});

it('hands the exact version and sheet to "Analyze this data" and refuses it for an older version', async () => {
  mockFetch(() => response(xlsx));
  const onAnalyze = jest.fn();
  const { rerender } = render(panel({ onAnalyze }));

  fireEvent.change(await screen.findByLabelText('Sheet'), {
    target: { value: 'Hidden' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze this data' }));
  expect(onAnalyze).toHaveBeenCalledWith({
    sourceId: xlsx.sourceId,
    sourceVersionId: xlsx.sourceVersionId,
    sheetName: 'Hidden',
  });

  rerender(panel({ onAnalyze, isLatestVersion: false }));
  const button = (await screen.findByRole('button', {
    name: 'Analyze this data',
  })) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    screen.getByText(/Analysis uses the latest version of this source/),
  ).not.toBeNull();
  expect(screen.getByText('2 (older version)')).not.toBeNull();
});

it('explains a version that is not processed yet, and reports any other failure', async () => {
  mockFetch(() => problem(409, 'CONFLICT'));
  const { unmount } = render(panel());
  const waiting = await screen.findByText(/not available yet/);
  expect(waiting.getAttribute('role')).toBe('status');
  expect(screen.queryByRole('alert')).toBeNull();
  unmount();

  mockFetch(() => problem(404, 'RESOURCE_NOT_FOUND'));
  render(panel());
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load dataset preview: RESOURCE_NOT_FOUND detail',
  );
});

it('handles a file without sheets, columns or sample rows', async () => {
  const none: DatasetPreview = { ...xlsx, sheets: [] };
  mockFetch(() => response(none));
  const { unmount } = render(panel());
  expect(
    await screen.findByText('This file contains no sheets to preview.'),
  ).not.toBeNull();
  unmount();

  const sheet = xlsx.sheets[0] as DatasetPreview['sheets'][number];
  const bare: DatasetPreview = {
    ...xlsx,
    sheets: [{ ...sheet, columns: [], sampleRows: [] }],
  };
  mockFetch(() => response(bare));
  render(panel());
  expect(
    await screen.findByText('This sheet has no columns to describe.'),
  ).not.toBeNull();
  expect(screen.getByText('No sample rows are available for this sheet.')).not.toBeNull();
});

it('shows missing-value counts as exact only when the whole sheet was profiled', async () => {
  const sheet = xlsx.sheets[0] as DatasetPreview['sheets'][number];
  const partial: DatasetPreview = {
    ...xlsx,
    sheets: [
      {
        ...sheet,
        columns: sheet.columns.map((column) => ({
          ...column,
          missingValuesExact: false,
        })),
      },
    ],
  };
  mockFetch(() => response(partial));
  render(panel());

  const types = await screen.findByRole('table', { name: 'Measurements column types' });
  expect(within(types).getAllByText('0 of 5 sampled').length).toBeGreaterThan(0);
});

it('caches an immutable version instead of fetching it again, and starts a new version on its first sheet', async () => {
  const fetchMock = mockFetch(() => response(xlsx));
  const queryClient = client();
  const first = render(panel({}, queryClient));
  fireEvent.change(await screen.findByLabelText('Sheet'), {
    target: { value: 'Hidden' },
  });
  first.unmount();

  render(panel({}, queryClient));
  expect(((await screen.findByLabelText('Sheet')) as HTMLSelectElement).value).toBe(
    'Measurements',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
