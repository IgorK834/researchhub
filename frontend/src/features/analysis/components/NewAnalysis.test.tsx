/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NewAnalysis } from './NewAnalysis';
import csvFixture from '../../../../../contracts/analysis/dataset-preview/v1/csv-preview.json';
import { savedAnalysis, savedRecord } from '../testing/analysisFixtures';
import type { DatasetPreview } from '../api/datasetPreviewApi';

const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}
const preview = csvFixture as unknown as DatasetPreview;
const choices = [
  { sourceId: 's', sourceVersionId: 'v3', label: 'measurements.csv · v3' },
  { sourceId: 'second', sourceVersionId: 'v4', label: 'second.csv · v4' },
];
function mount(props: Partial<Parameters<typeof NewAnalysis>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NewAnalysis
          workspaceId="w"
          datasets={choices}
          onCreated={jest.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  globalThis.fetch = originalFetch;
});
it('selects immutable data and runs create → plan → execute, forwarding only the chosen columns', async () => {
  const created = jest.fn();
  const mock = jest.fn(async (url, options?: RequestInit) => {
    if (String(url).endsWith('/preview')) return response(preview);
    if (String(url).endsWith('/plan')) return response(savedAnalysis());
    if (String(url).endsWith('/execute')) return response(savedRecord().execution, 202);
    return response(savedAnalysis(), 201);
  });
  globalThis.fetch = mock;
  mount({ onCreated: created });
  expect(screen.getByRole('status').textContent).toContain('Loading dataset structure');
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText('Source version'), { target: { value: 'v4' } });
  await screen.findByRole('table');
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  fireEvent.change(screen.getByLabelText('Analysis request'), {
    target: { value: '  Calculate impedance U/I.  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith('a'));
  const posts = mock.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts.map(([url]) => String(url))).toEqual([
    '/api/workspaces/w/analyses',
    '/api/workspaces/w/analyses/a/plan',
    '/api/workspaces/w/analyses/a/execute',
  ]);
  const command = JSON.parse(String(posts[0]![1]!.body));
  expect(command.userPrompt).toBe('Calculate impedance U/I.');
  expect(command.inputs).toEqual([
    {
      sourceId: 'second',
      sourceVersionId: 'v4',
      sheetName: preview.sheets[0]!.name,
      columns: preview.sheets[0]!.columns.slice(1).map((c) => c.index),
    },
  ]);
});
it('never submits an empty prompt or an empty column selection and resets columns on sheet changes', async () => {
  globalThis.fetch = jest.fn(async () =>
    response({
      ...preview,
      sheets: [...preview.sheets, { ...preview.sheets[0]!, name: 'other' }],
    }),
  );
  mount();
  await screen.findByRole('table');
  expect(
    (screen.getByRole('button', { name: 'Run analysis' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Analysis request'), {
    target: { value: 'Compute results' },
  });
  screen.getAllByRole('checkbox').forEach((c) => fireEvent.click(c));
  expect(
    (screen.getByRole('button', { name: 'Run analysis' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  expect(
    (screen.getByRole('button', { name: 'Run analysis' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText('Sheet'), { target: { value: 'other' } });
  expect(
    screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked),
  ).toBe(true);
});
it('exposes a saved request when planning or enqueueing fails instead of losing its evidence', async () => {
  globalThis.fetch = jest.fn(async (url) =>
    String(url).endsWith('/preview')
      ? response(preview)
      : String(url).endsWith('/analyses')
        ? response(savedAnalysis(), 201)
        : response(
            {
              status: 503,
              code: 'AI_UNAVAILABLE',
              title: 'Unavailable',
              detail: 'Try later',
            },
            503,
          ),
  );
  mount();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText('Analysis request'), {
    target: { value: 'Compute U/I' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  expect(await screen.findByRole('link', { name: 'Open saved analysis' })).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(
    'The analysis could not be started',
  );
});
it('keeps pending forms stable and disables repeated submission', async () => {
  let resolve!: (value: Response) => void;
  globalThis.fetch = jest.fn(async (url) =>
    String(url).endsWith('/preview')
      ? response(preview)
      : new Promise<Response>((r) => {
          resolve = r;
        }),
  );
  mount();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText('Analysis request'), {
    target: { value: 'Compute U/I' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Preparing analysis…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  resolve(response({ status: 400, code: 'VALIDATION_FAILED', title: 'Invalid' }, 400));
  await screen.findByRole('alert');
});
it('handles no datasets, unavailable inspection and empty workbook structures', async () => {
  const first = mount({ datasets: [] });
  expect(screen.getByText(/No ready CSV or XLSX datasets/)).not.toBeNull();
  first.unmount();
  globalThis.fetch = jest.fn(async () =>
    response({ status: 404, code: 'RESOURCE_NOT_FOUND', title: 'Unavailable' }, 404),
  );
  const second = mount();
  expect(await screen.findByText('Could not inspect this version')).not.toBeNull();
  second.unmount();
  globalThis.fetch = jest.fn(async () => response({ ...preview, sheets: [] }));
  mount();
  expect(await screen.findByText(/No inspected sheets/)).not.toBeNull();
});
it('honors preselected versions, records preview limitations and handles a removed initial selection', async () => {
  const mock = jest.fn(async (_url: RequestInfo | URL) =>
    response({ ...preview, truncated: true }),
  );
  globalThis.fetch = mock;
  const first = mount({ initialVersionId: 'v4' });
  await screen.findByText(/Preview limited/);
  expect(mock.mock.calls[0]?.[0]).toContain('/second/versions/v4/preview');
  first.unmount();
  mount({ initialVersionId: 'removed' });
  await screen.findByRole('table');
  expect((screen.getByLabelText('Source version') as HTMLSelectElement).value).toBe('v3');
});
