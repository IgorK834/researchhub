/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { savedRecord, savedAnalysis } from '../testing/analysisFixtures';
import type {
  Analysis,
  ExecutionRecord,
  AnalysisLineage as Lineage,
} from '../api/analysisApi';
import { AnalysisStudio } from './AnalysisStudio';
import { AnalysisList } from './AnalysisList';
import { AnalysisChart } from './AnalysisChart';
import { AnalysisResult, ResultTable } from './AnalysisResult';
import { AnalysisProvenance } from './AnalysisProvenance';
import { AnalysisStatus } from './AnalysisStatus';
import { AnalysisLineage } from './AnalysisLineage';
import { desktopMedia } from '../../../shared/testing/desktopMedia';

const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL,
  originalRevoke = URL.revokeObjectURL;
let media: ReturnType<typeof desktopMedia>;
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
function failure(code = 'RESOURCE_NOT_FOUND', status = 404): Response {
  return response(
    { status, code, title: 'Unavailable', detail: 'This resource is unavailable.' },
    status,
  );
}
function Location(): ReactElement {
  const value = useLocation();
  return (
    <output aria-label="Current location">
      {value.pathname}
      {value.search}
    </output>
  );
}
function mount(element: ReactElement, path = '/app/workspaces/w/analyses/a') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {element}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function api(
  analysis: Analysis = savedAnalysis(),
  records: ExecutionRecord[] = [savedRecord()],
) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/origin')) return response({ lineage: null });
    if (path.endsWith('/rerun')) {
      const next = savedRecord(`run-${records.length + 1}`, records.length + 1);
      records.push(next);
      return response(
        {
          analysisId: 'a',
          execution: { ...next.execution, status: 'QUEUED' },
          lineage: null,
          failureCode: null,
        },
        202,
      );
    }
    if (path.endsWith('/execute')) {
      const next = savedRecord(`run-${records.length + 1}`, records.length + 1);
      records.push(next);
      return response({ ...next.execution, status: 'QUEUED' }, 202);
    }
    if (path.endsWith('/plan'))
      return response({
        ...analysis,
        plan: savedRecord().snapshot.plan,
        status: 'READY_TO_EXECUTE',
      });
    if (path.endsWith('/analyses/a')) return response(analysis);
    if (path.includes('/artifacts/'))
      return {
        ok: true,
        blob: () => Promise.resolve(new Blob([new Uint8Array(8)], { type: 'image/png' })),
      } as Response;
    if (path.endsWith('/executions')) return response(records.map((r) => r.execution));
    if (path.endsWith('/record')) {
      const record = records.find((r) => path.includes(`/executions/${r.execution.id}/`));
      return record ? response(record) : failure();
    }
    if (path.includes('/analyses?offset=')) return response([analysis]);
    throw new Error(`Unexpected request: ${options?.method} ${path}`);
  });
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}
beforeEach(() => {
  media = desktopMedia();
  URL.createObjectURL = jest.fn(() => 'blob:saved-image');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  media.restore();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

it('renders stored chart/table data and its exact code/version provenance without parsing Python', async () => {
  api();
  const result = mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  expect(
    await screen.findByRole('heading', { name: 'Impedance magnitude versus frequency' }),
  ).not.toBeNull();
  const image = await screen.findByAltText('Impedance magnitude versus frequency');
  await waitFor(() => expect(image.getAttribute('src')).toBe('blob:saved-image'));
  expect(screen.getByText('Frequency f (Hz) · log')).not.toBeNull();
  expect(screen.getByText(/2 points from impedance-table/)).not.toBeNull();
  expect(screen.getByRole('table').textContent).toContain('2000');
  expect(screen.getByText('Current [3]', { exact: false })).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'measurements.xlsx · v3' }).getAttribute('href'),
  ).toContain('version=v3');
  expect(screen.getByText('c'.repeat(64))).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
  expect(screen.getByText(/# <script>untrusted text/)).not.toBeNull();
  expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByText('Execution diagnostics'));
  expect(screen.getByText('2 rows computed')).not.toBeNull();
  result.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved-image');
});
it('keeps deep-linked historical attempts inspectable and creates an explicit new attempt on re-run', async () => {
  const old = savedRecord();
  old.charts = [
    { ...old.charts[0]!, metadataAvailable: false, xAxis: null, yAxis: null, series: [] },
  ];
  const fetchMock = api(savedAnalysis(), [old, savedRecord('run-2', 2)]);
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText(/Viewing attempt 2/);
  fireEvent.change(screen.getByLabelText('Execution attempt'), {
    target: { value: 'run-1' },
  });
  expect(await screen.findByText(/This earlier run did not record/)).not.toBeNull();
  expect(screen.getByLabelText('Current location').textContent).toContain(
    'execution=run-1',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Re-run with original inputs' }));
  await screen.findByText(/Viewing attempt 3/);
  expect(
    fetchMock.mock.calls.some(
      ([url, options]) => String(url).endsWith('/rerun') && options?.method === 'POST',
    ),
  ).toBe(true);
  expect(
    screen.getByLabelText('Execution attempt').querySelectorAll('option').length,
  ).toBe(3);
});
it('opens provenance in the responsive slide-over and viewers have no run control', async () => {
  media.resize(true);
  api();
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit={false} />);
  await screen.findByRole('heading', { name: 'Impedance magnitude versus frequency' });
  expect(
    screen.queryByRole('button', { name: 'Re-run with original inputs' }),
  ).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'View provenance' })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'Provenance' });
  expect(within(dialog).getByText('c'.repeat(64))).not.toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('reads an old successful result after remount without executing again', async () => {
  const fetchMock = api();
  const first = mount(
    <AnalysisStudio workspaceId="w" analysisId="a" canEdit />,
    '/app/workspaces/w/analyses/a?execution=run-1',
  );
  await screen.findByText(/Viewing attempt 1/);
  first.unmount();
  mount(
    <AnalysisStudio workspaceId="w" analysisId="a" canEdit />,
    '/app/workspaces/w/analyses/a?execution=run-1',
  );
  await screen.findByText(/Viewing attempt 1/);
  expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(
    true,
  );
});
it.each(['QUEUED', 'RUNNING', 'FAILED'] as const)(
  'shows persisted %s state without manufacturing computed output',
  async (status) => {
    const record = savedRecord();
    record.execution = {
      ...record.execution,
      status,
      result: null,
      finishedAt: null,
      failureCode: status === 'FAILED' ? 'EXECUTION_TIMEOUT' : null,
    };
    record.charts = [];
    api({ ...savedAnalysis(), status }, [record]);
    mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
    if (status === 'FAILED')
      expect(
        await screen.findByText(/This attempt could not be completed/),
      ).not.toBeNull();
    else expect(await screen.findByText('Working on your analysis')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No computed result was published.')).not.toBeNull();
  },
);
it('starts a saved draft through plan then execution, and reports an enqueue failure safely', async () => {
  const draft = {
    ...savedAnalysis(),
    status: 'DRAFT' as const,
    plan: null,
    planId: null,
  };
  const mock = api(draft, []);
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('No executions yet');
  fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
  await screen.findByText(/Viewing attempt 1/);
  const mutations = mock.mock.calls
    .filter(([, o]) => o?.method === 'POST')
    .map(([url]) => String(url));
  expect(mutations).toEqual([
    '/api/workspaces/w/analyses/a/plan',
    '/api/workspaces/w/analyses/a/execute',
  ]);
});
it('shows inaccessible analysis, history or attempts without exposing other records', async () => {
  globalThis.fetch = jest.fn(async () => failure());
  const first = mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  expect(await screen.findByText('Analysis unavailable')).not.toBeNull();
  first.unmount();
  const base = api();
  globalThis.fetch = jest.fn(async (url, options) =>
    String(url).endsWith('/executions') ? failure() : base(url, options),
  );
  const second = mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  expect(await screen.findByText('Could not load run history')).not.toBeNull();
  second.unmount();
  api();
  mount(
    <AnalysisStudio workspaceId="w" analysisId="a" canEdit />,
    '/app/workspaces/w/analyses/a?execution=foreign',
  );
  expect(await screen.findByText('Saved execution unavailable')).not.toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});
it('preserves saved details when re-run is rejected by the server', async () => {
  const base = api();
  globalThis.fetch = jest.fn(async (url, options) =>
    String(url).endsWith('/rerun') ? failure('CONFLICT', 409) : base(url, options),
  );
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText(/Viewing attempt 1/);
  fireEvent.click(screen.getByRole('button', { name: 'Re-run with original inputs' }));
  expect(await screen.findByText('Could not re-run this analysis')).not.toBeNull();
  expect(screen.getByRole('table')).not.toBeNull();
});
it('handles chart download failures and retries, retaining metadata', async () => {
  let calls = 0;
  const base = api();
  globalThis.fetch = jest.fn(async (url, options) =>
    String(url).includes('/artifacts/') && calls++ === 0 ? failure() : base(url, options),
  );
  mount(
    <AnalysisChart
      workspaceId="w"
      chart={savedRecord().charts[0]!}
      onDetails={jest.fn()}
    />,
  );
  expect(await screen.findByRole('alert')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      screen.getByAltText('Impedance magnitude versus frequency').getAttribute('src'),
    ).toBe('blob:saved-image'),
  );
});
it('pages large saved tables and renders null/boolean cells as inert text', () => {
  const rows = Array.from({ length: 26 }, (_, i) => [
    i === 0 ? null : i,
    i === 0 ? true : false,
  ]);
  mount(
    <ResultTable
      output={{ kind: 'TABLE', name: 'result', columns: ['value', 'flag'], rows }}
    />,
  );
  expect(screen.getByRole('table').textContent).toContain('—true');
  fireEvent.click(screen.getByRole('button', { name: 'Next rows' }));
  expect(screen.getByText('26–26 of 26 rows')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Previous rows' }));
  expect(screen.getByText('1–25 of 26 rows')).not.toBeNull();
});
it('renders an empty table and non-chart text outputs without interpreting markup', () => {
  const record = savedRecord();
  record.charts = [];
  record.execution.result = {
    schemaVersion: '1.0',
    outputs: [
      { kind: 'TEXT', name: 'note', text: '<img src=x onerror=alert(1)>' },
      { kind: 'TABLE', name: 'empty', columns: ['x'], rows: [] },
    ],
  };
  mount(<AnalysisResult record={record} onDetails={jest.fn()} />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).not.toBeNull();
  expect(screen.getByText('0 of 0 rows')).not.toBeNull();
  expect(document.querySelector('img')).toBeNull();
});
it('shows missing historical diagnostics and column labels without guessing', () => {
  const record = savedRecord();
  record.execution = {
    ...record.execution,
    status: 'QUEUED',
    startedAt: null,
    finishedAt: null,
    diagnostics: null,
    result: null,
    provenance: { ...record.execution.provenance, imageId: null, runtimeVersion: null },
  };
  record.snapshot.inputs[0]!.sheets[0]!.columns[0] = { index: 1, label: null };
  record.charts = [];
  mount(<AnalysisProvenance record={record} />);
  expect(screen.getByText('Not started')).not.toBeNull();
  expect(screen.getByText('Column [1]', { exact: false })).not.toBeNull();
});
it.each([
  'DRAFT',
  'PLANNING',
  'READY_TO_EXECUTE',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
] as const)('names the %s status with an icon', (status) => {
  mount(<AnalysisStatus status={status} />);
  expect(document.querySelector('svg')).not.toBeNull();
});
it('handles unfamiliar server statuses visibly', () => {
  mount(<AnalysisStatus status={'NEW_STATUS' as never} />);
  expect(screen.getByText('NEW_STATUS')).not.toBeNull();
});
it('lists saved analyses with protected navigation and pages through older requests', async () => {
  const list = Array.from({ length: 50 }, (_, i) => ({
    ...savedAnalysis(),
    id: `a${i}`,
    plan: null,
    inputs: i === 0 ? [] : savedAnalysis().inputs,
  }));
  globalThis.fetch = jest.fn(async (url) =>
    response(String(url).includes('offset=50') ? [] : list),
  );
  mount(<AnalysisList workspaceId="w" canEdit />);
  await screen.findAllByRole('link', { name: 'Open analysis' });
  expect(screen.getByRole('link', { name: 'New analysis' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Older analyses' }));
  await screen.findByText('No analyses on this page');
  fireEvent.click(screen.getByRole('button', { name: 'Newer analyses' }));
  await screen.findAllByRole('link', { name: 'Open analysis' });
});
it('shows read-only empty list and recovers from a list request failure', async () => {
  let fail = true;
  globalThis.fetch = jest.fn(async () => (fail ? failure() : response([])));
  mount(<AnalysisList workspaceId="w" canEdit={false} />);
  await screen.findByText('Could not load analyses');
  expect(screen.queryByRole('link', { name: 'New analysis' })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No analyses on this page');
});
it('shows the accepted plan, warnings and opt-in read-only code without executing it', async () => {
  const mock = api();
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText(/Viewing attempt 1/);
  expect(screen.getAllByText('Verify units before re-running.').length).toBeGreaterThan(
    0,
  );
  expect(screen.queryByText(/# Exact recorded Python/)).toBeNull();
  fireEvent.click(screen.getByText('Analysis plan'));
  expect(screen.queryByText('No assumptions recorded.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
  const code = screen.getByRole('region', { name: 'Generated code, read-only' });
  expect(document.activeElement).toBe(code);
  expect(code.textContent).toContain('# Exact recorded Python');
  expect(code.querySelector('textarea,input,[contenteditable="true"]')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Insert into document' }).hasAttribute('disabled'),
  ).toBe(false);
  expect(
    screen.getByRole('link', { name: 'Provenance API (JSON)' }).getAttribute('href'),
  ).toContain('/run-1/provenance');
  expect(document.getElementById('output-0')?.textContent).toContain('2000');
  expect(document.getElementById('output-1')?.textContent).toContain(
    'Impedance magnitude versus frequency',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide code' }));
  expect(screen.queryByText(/# Exact recorded Python/)).toBeNull();
  expect(mock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});
it('sends the latest-input mode explicitly, prevents duplicate runs and navigates to a retained derived request', async () => {
  const base = api();
  let resolve!: (r: Response) => void;
  const mock = jest.fn(async (url: RequestInfo | URL, options?: RequestInit) =>
    String(url).endsWith('/rerun')
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : base(url, options),
  );
  globalThis.fetch = mock;
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText(/Viewing attempt 1/);
  const latest = screen.getByRole('button', { name: 'Re-run against latest sources' });
  fireEvent.click(latest);
  await screen.findByText('Checking latest versions and preparing a new analysis…');
  expect(latest.hasAttribute('disabled')).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Re-run with original inputs' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(latest);
  const calls = mock.mock.calls.filter(([url]) => String(url).endsWith('/rerun'));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0]![1]!.body as string)).toEqual({ inputMode: 'LATEST' });
  resolve(
    response(
      {
        analysisId: 'derived',
        execution: null,
        lineage: null,
        failureCode: 'AI_OUTPUT_INVALID',
      },
      202,
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Current location').textContent).toBe(
      '/app/workspaces/w/analyses/derived',
    ),
  );
});
const changedLineage = {
  originAnalysisId: 'original',
  originExecutionId: 'old-run',
  inputMode: 'LATEST',
  versions: [
    {
      sourceId: 's',
      originalVersionId: 'v3',
      originalVersionNumber: 3,
      selectedVersionId: 'v4',
      selectedVersionNumber: 4,
    },
  ],
  requestedRuntime: null,
} satisfies Lineage;
it('marks changed inputs and keeps an exact link to the original execution', async () => {
  const record = savedRecord();
  record.snapshot.lineage = changedLineage;
  api(savedAnalysis(), [record]);
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('Inputs changed for this run');
  expect(screen.getByText(/v3 → v4 \(changed\)/)).not.toBeNull();
  expect(
    screen.getByRole('link', { name: 'View original execution' }).getAttribute('href'),
  ).toBe('/app/workspaces/w/analyses/original?execution=old-run');
});
it('makes an unchanged latest-input selection explicit and reports a missing original runtime', async () => {
  const lineage = {
    ...changedLineage,
    versions: [
      {
        ...changedLineage.versions[0]!,
        selectedVersionId: 'v3',
        selectedVersionNumber: 3,
      },
    ],
  };
  const record = savedRecord();
  record.snapshot.lineage = lineage;
  record.execution.provenance.imageId = null;
  api(savedAnalysis(), [record]);
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('Original input versions retained');
  expect(screen.getByText(/v3 → v3 \(unchanged\)/)).not.toBeNull();
  expect(screen.getByText('Original runtime was not recorded')).not.toBeNull();
});
it('describes an original-input rerun without suggesting that the source versions changed', () => {
  mount(
    <AnalysisLineage
      workspaceId="w"
      lineage={{
        ...changedLineage,
        inputMode: 'ORIGINAL',
        versions: [{ ...changedLineage.versions[0]!, selectedVersionId: 'v3' }],
      }}
    />,
  );
  expect(
    screen.getByText('This attempt uses the original source versions and accepted code.'),
  ).not.toBeNull();
});
it.each([
  'EXECUTION_RESOURCE_LIMIT',
  'EXECUTION_FAILED',
  'UNKNOWN_FAILURE',
  '__proto__',
  'constructor',
])(
  'shows safe guidance for %s even when retained diagnostics contain sensitive traceback text',
  async (failureCode) => {
    const record = savedRecord();
    record.execution.status = 'FAILED';
    record.execution.result = null;
    record.charts = [];
    record.execution.failureCode = failureCode;
    record.execution.diagnostics!.stderr =
      'Traceback /private/host/secret.py password=topsecret';
    record.execution.diagnostics!.stdout = 'private-user-value';
    api({ ...savedAnalysis(), status: 'FAILED' }, [record]);
    mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
    await screen.findByText('This attempt could not be completed');
    fireEvent.click(screen.getByText('Execution diagnostics'));
    expect(
      screen.getByText(/Failure diagnostics are represented by the safe guidance/),
    ).not.toBeNull();
    expect(document.body.textContent).not.toMatch(
      /topsecret|secret.py|private-user-value/,
    );
  },
);
it('keeps a failed derived plan, its origin and request visible with a path to create a reviewed analysis', async () => {
  const draft = {
    ...savedAnalysis(),
    status: 'FAILED' as const,
    plan: null,
    planId: null,
    failureCode: 'AI_OUTPUT_INVALID',
  };
  const base = api(draft, []);
  globalThis.fetch = jest.fn(async (url, options) =>
    String(url).endsWith('/origin')
      ? response({ lineage: changedLineage })
      : base(url, options),
  );
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('The analysis plan could not be completed');
  await screen.findByText('Inputs changed for this run');
  expect(
    screen.getByRole('link', { name: 'Create a new analysis' }).getAttribute('href'),
  ).toContain('/analyses/new');
  expect(screen.queryByRole('button', { name: 'Run analysis' })).toBeNull();
});
it('does not mislabel a saved historical success while a different attempt is running', async () => {
  api({ ...savedAnalysis(), status: 'RUNNING' });
  mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
  await screen.findByText('Another attempt is in progress');
  expect(screen.getByRole('table')).not.toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Re-run with original inputs' }),
  ).toBeNull();
});
it.each(['history', 'record'] as const)(
  'waits for saved %s before offering the explicit rerun modes',
  async (loading) => {
    const base = api();
    let resolve!: (r: Response) => void;
    const mock = jest.fn(async (url: RequestInfo | URL, options?: RequestInit) =>
      String(url).endsWith(loading === 'history' ? '/executions' : '/record')
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : base(url, options),
    );
    globalThis.fetch = mock;
    mount(<AnalysisStudio workspaceId="w" analysisId="a" canEdit />);
    await screen.findByText(
      loading === 'history' ? 'Loading run history…' : 'Loading saved execution…',
    );
    expect(screen.queryByRole('button', { name: 'Run analysis' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Re-run same data and code' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Re-run with original inputs' }),
    ).toBeNull();
    resolve(response(loading === 'history' ? [savedRecord().execution] : savedRecord()));
    await screen.findByRole('button', { name: 'Re-run with original inputs' });
    expect(
      screen.getByRole('button', { name: 'Re-run against latest sources' }),
    ).not.toBeNull();
    expect(mock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
  },
);
