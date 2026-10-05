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

  expect(screen.getByRole('heading', { name: 'people.csv' })).not.toBeNull();
  expect(screen.getByText(/CSV · 1 sheet in this preview/)).not.toBeNull();
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
  const headers = within(sample).getAllByRole('columnheader');
  expect(headers[0]?.textContent).toBe('Row');
  for (const column of csv.sheets[0]!.columns)
    expect(within(sample).getByText(column.name)).not.toBeNull();
  expect(within(sample).getByLabelText('Inferred type: integer').textContent).toBe('123');
  expect(within(sample).getByLabelText('Inferred type: text').textContent).toBe('abc');
  const rows = within(sample).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0] as HTMLElement).getByText('Ada')).not.toBeNull();
  expect(within(rows[0] as HTMLElement).getByRole('rowheader').textContent).toBe('2');
  // The preview is complete and exact, so there is no truncation notice and no analyze button without a handler.
  expect(screen.queryByLabelText('Preview limits')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Analyze this data' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'CSV 2', selected: true })).toBeTruthy();
  expect(
    screen.getByText(/Formulas are shown as text and are never calculated/),
  ).not.toBeNull();
});

it('lists every sheet, labels hidden ones, defaults to the first visible sheet and shows formulas as text', async () => {
  mockFetch(() => response(xlsx));
  render(panel());

  const tabs = await screen.findByRole('tablist', { name: 'Sheets' });
  expect(
    within(tabs).getByRole('tab', { name: 'Measurements 5', selected: true }),
  ).toBeTruthy();
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent),
  ).toEqual([
    'Measurements 5',
    'Hidden (hidden) 0',
    'Internal (very hidden) 0',
    'Empty 0',
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

  fireEvent.click(screen.getByRole('tab', { name: 'Hidden (hidden) 0' }));
  expect(screen.getByRole('table', { name: 'Hidden column types' })).not.toBeNull();
  expect(screen.getByText('No sample rows are available for this sheet.')).not.toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Empty 0' }));
  expect(screen.getByText('none')).not.toBeNull();
  expect(
    within(screen.getByLabelText('Sheet size')).getByText('Data rows').nextElementSibling
      ?.textContent,
  ).toBe('0');
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

  fireEvent.click(screen.getByRole('tab', { name: 'Unknown' }));
  expect(
    within(screen.getByLabelText('Sheet size')).getByText(
      'unknown (the first 12 rows were scanned)',
    ),
  ).not.toBeNull();
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

  fireEvent.click(await screen.findByRole('tab', { name: 'Hidden (hidden) 0' }));
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
    screen.getByText(/Analysis and questions use the latest version of this source/),
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
  fireEvent.click(await screen.findByRole('tab', { name: 'Hidden (hidden) 0' }));
  first.unmount();

  render(panel({}, queryClient));
  expect(
    await screen.findByRole('tab', { name: 'Measurements 5', selected: true }),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('supports keyboard sheet navigation without refetching or duplicating hidden tables', async () => {
  const fetchMock = mockFetch(() => response(xlsx));
  render(panel());
  const selected = await screen.findByRole('tab', {
    name: 'Measurements 5',
    selected: true,
  });
  selected.focus();
  fireEvent.keyDown(selected, { key: 'ArrowRight' });
  const hidden = screen.getByRole('tab', { name: 'Hidden (hidden) 0', selected: true });
  expect(document.activeElement).toBe(hidden);
  expect(
    screen.queryByRole('table', { name: 'Measurements dataset preview', hidden: true }),
  ).toBeNull();
  expect(screen.getByRole('table', { name: 'Hidden column types' })).toBeTruthy();
  fireEvent.keyDown(hidden, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Empty 0', selected: true })).toBe(
    document.activeElement,
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'Measurements 5', selected: true })).toBe(
    document.activeElement,
  );
  expect(screen.getByRole('region', { name: 'Measurements sample rows' })).toHaveProperty(
    'tabIndex',
    0,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('names the selected sheet, retains version provenance and wires both existing header actions', async () => {
  mockFetch(() => response(xlsx));
  const onAnalyze = jest.fn(),
    onAsk = jest.fn();
  const { rerender } = render(
    panel({
      sourceName: 'Research data',
      sourceInfo: <p>Known source metadata</p>,
      onAnalyze,
      onAsk,
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Research data' })).toBeTruthy();
  expect(
    within(await screen.findByLabelText('Source version')).getByText('measurements.xlsx'),
  ).toBeTruthy();
  expect(screen.getByText('Known source metadata')).toBeTruthy();
  const details = within(screen.getByRole('region', { name: 'Sheet details' }));
  expect(details.getByText('Sheet').nextElementSibling?.textContent).toBe('Measurements');
  fireEvent.click(screen.getByRole('button', { name: 'Ask about data' }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze this data' }));
  expect(onAnalyze).toHaveBeenCalledWith({
    sourceId: xlsx.sourceId,
    sourceVersionId: xlsx.sourceVersionId,
    sheetName: 'Measurements',
  });
  rerender(panel({ onAnalyze, onAsk, isLatestVersion: false }));
  expect(screen.getByRole('button', { name: 'Ask about data' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Analyze this data' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask about data' }));
  expect(onAsk).toHaveBeenCalledTimes(1);
});

it('resets sheet selection only when opening another immutable version', async () => {
  let reply = xlsx;
  const fetchMock = mockFetch(() => response(reply));
  const queryClient = client();
  const view = render(panel({}, queryClient));
  fireEvent.click(await screen.findByRole('tab', { name: 'Hidden (hidden) 0' }));
  view.rerender(panel({ sourceName: 'Renamed source' }, queryClient));
  expect(
    screen.getByRole('tab', { name: 'Hidden (hidden) 0', selected: true }),
  ).toBeTruthy();
  reply = { ...xlsx, sourceVersionId: 'new-version', versionNumber: 3 };
  view.rerender(panel({ sourceVersionId: 'new-version' }, queryClient));
  expect(
    await screen.findByRole('tab', { name: 'Measurements 5', selected: true }),
  ).toBeTruthy();
  expect(
    within(screen.getByLabelText('Source version')).getByText('3 (latest)'),
  ).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps all limit banners and notes visible while switching sheets, with the server caps unchanged', async () => {
  const fetchMock = mockFetch(() => response(large));
  render(panel());
  await screen.findByLabelText('Preview limits');
  for (const name of ['Wide', 'Unknown', 'Wide']) {
    fireEvent.click(screen.getByRole('tab', { name }));
    const limits = screen.getByLabelText('Preview limits');
    expect(limits.getAttribute('role')).toBe('status');
    for (const warning of large.warnings.filter((warning) =>
      [
        'SHEETS_OMITTED',
        'ROWS_TRUNCATED',
        'COLUMNS_TRUNCATED',
        'VALUES_SHORTENED',
      ].includes(warning.code),
    ))
      expect(limits.textContent).toContain(warning.message);
    expect(screen.getByLabelText('Notes about this preview').getAttribute('role')).toBe(
      'status',
    );
    expect(
      screen.getByText(
        /limited to 10 rows per sheet, 100 columns per sheet, 10 sheets, 300 cells and 65,536 bytes/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Each value is limited to 96 UTF-8 bytes/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Load more|Create analysis|Check before/ }),
    ).toBeNull();
  }
  const data = screen.getByRole('table', { name: 'Wide dataset preview' });
  expect(within(data).getAllByRole('row')).toHaveLength(
    large.sheets[0]!.sampleRows.length + 1,
  );
  expect(within(data).getAllByRole('columnheader')).toHaveLength(
    large.sheets[0]!.columns.length + 1,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('shows null dimensions as unknown, retains only reported types, and leaves absent cell text empty', async () => {
  const sheet = csv.sheets[0]!;
  const data: DatasetPreview = {
    ...csv,
    sheets: [
      {
        ...sheet,
        dimensions: { ...sheet.dimensions, columnCount: null },
        columns: ['ERROR', 'MIXED', 'UNKNOWN'].map((inferredType, index) => ({
          ...sheet.columns[0]!,
          inferredType: inferredType as 'ERROR' | 'MIXED' | 'UNKNOWN',
          index: index + 1,
          name: 'Column ' + index,
          profiledValues: 0,
        })),
        sampleRows: [{ rowNumber: 2, cells: ['#VALUE!', 'https://example.test'] }],
      },
    ],
  };
  mockFetch(() => response(data));
  render(panel());
  const grid = await screen.findByRole('table', { name: 'CSV dataset preview' });
  expect(
    within(screen.getByLabelText('Sheet size')).getByText('3 shown (total unknown)'),
  ).toBeTruthy();
  expect(within(grid).getByLabelText('Inferred type: error value')).toBeTruthy();
  expect(within(grid).getByLabelText('Inferred type: mixed')).toBeTruthy();
  expect(within(grid).getByLabelText('Inferred type: unknown')).toBeTruthy();
  expect(within(grid).getAllByRole('cell')[2]?.textContent).toBe('');
  expect(within(grid).queryByRole('link')).toBeNull();
  expect(
    within(screen.getByRole('table', { name: 'CSV column types' })).getAllByText('—'),
  ).toHaveLength(3);
});

it('uses the first available sheet when all sheets are hidden and keeps no-sheet actions bounded', async () => {
  mockFetch(() =>
    response({
      ...xlsx,
      sheets: xlsx.sheets.filter((sheet) => sheet.state !== 'visible'),
    }),
  );
  const view = render(panel());
  expect(
    await screen.findByRole('tab', { name: 'Hidden (hidden) 0', selected: true }),
  ).toBeTruthy();
  view.unmount();
  mockFetch(() => response({ ...xlsx, sheets: [] }));
  render(panel({ onAnalyze: jest.fn(), onAsk: jest.fn(), isLatestVersion: false }));
  await screen.findByText('This file contains no sheets to preview.');
  expect(screen.getByRole('button', { name: 'Analyze this data' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Ask about data' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByLabelText('Notes about this preview').textContent).toContain(
    'never calculated',
  );
});

it('never hides a response-size warning even when no sample rows remain', async () => {
  mockFetch(() =>
    response({
      ...csv,
      truncated: false,
      warnings: [
        {
          code: 'RESPONSE_SIZE_CAPPED',
          sheet: null,
          message: 'Sample rows were omitted to keep the preview under the byte cap.',
        },
      ],
      sheets: [{ ...csv.sheets[0]!, sampleRows: [] }],
    }),
  );
  render(panel());
  expect((await screen.findByLabelText('Preview limits')).textContent).toContain(
    'Sample rows were omitted to keep the preview under the byte cap.',
  );
  expect(screen.getByText('No sample rows are available for this sheet.')).toBeTruthy();
});

it('escapes file, sheet, header, warning and formula-looking values without creating executable or navigable content', async () => {
  const formula = '=HYPERLINK("javascript:alert(1)","click")';
  const name = '<img src=x onerror=alert(1)>';
  mockFetch(() =>
    response({
      ...csv,
      originalFilename: name,
      warnings: [
        {
          code: 'TYPES_INFERRED',
          sheet: null,
          message: '<iframe src="https://example.test"></iframe>',
        },
      ],
      sheets: [
        {
          ...csv.sheets[0]!,
          name: '<script>alert(1)</script>',
          columns: [
            {
              ...csv.sheets[0]!.columns[0]!,
              name: '<a href="javascript:alert(1)">click</a>',
              inferredType: 'FORMULA',
            },
          ],
          sampleRows: [{ rowNumber: 2, cells: [formula] }],
        },
      ],
    }),
  );
  const { container } = render(panel());
  expect(await screen.findByText(formula)).toBeTruthy();
  expect(screen.getByRole('heading', { name })).toBeTruthy();
  expect(screen.getByLabelText('Notes about this preview').textContent).toContain(
    '<iframe',
  );
  expect(container.querySelector('img, script, iframe, a, input, object')).toBeNull();
});
