/** @jest-environment jsdom */
import { savedDocumentOf } from '../api/documentContent';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import * as api from '../../analysis/api/analysisApi';
import * as sources from '../../sources/api/sourceApi';
import {
  semanticRecord,
  semanticAnalysis,
  reference,
  newerId,
  blockId,
  executionId,
  analysisId,
} from '../../analysis/testing/semanticFixtures';
import { ReferencedOutput } from './DocumentAnalysisBlock';
import { DocumentBodyEditor } from './DocumentBodyEditor';
import { DocumentSources } from './DocumentSources';
import { analysisBlock } from '../api/analysisReference';
import { desktopMedia } from '../../../shared/testing/desktopMedia';

let client: QueryClient;
let media: ReturnType<typeof desktopMedia>;
beforeEach(() => {
  media = desktopMedia();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest
    .spyOn(api, 'fetchExecutionRecord')
    .mockImplementation(async (_w, _a, e) => semanticRecord(e));
  jest.spyOn(api, 'fetchAnalyses').mockResolvedValue([semanticAnalysis()]);
  jest
    .spyOn(api, 'fetchExecutions')
    .mockResolvedValue([semanticRecord(newerId).execution, semanticRecord().execution]);
  jest
    .spyOn(api, 'fetchChartImage')
    .mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  jest.spyOn(sources, 'fetchSources').mockResolvedValue([]);
  URL.createObjectURL = jest.fn(() => 'blob:saved-plot');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  cleanup();
  client.clear();
  media.restore();
  jest.restoreAllMocks();
});
function mount(child: ReactElement) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}
test('chart block displays exact saved output and source version, and opens provenance', async () => {
  jest
    .mocked(sources.fetchSources)
    .mockResolvedValue([{ id: 's', activeVersionId: 'v4' }] as never);
  const update = jest.fn();
  mount(
    <ReferencedOutput
      workspaceId="w"
      reference={reference}
      caption="<script>caption</script>"
      canEdit
      onUpdate={update}
    />,
  );
  expect(screen.getByRole('status')).toBeTruthy();
  expect(await screen.findByAltText('Impedance magnitude versus frequency')).toBeTruthy();
  expect(screen.getByText(/Source: measurements.xlsx · v3 · measurements/)).toBeTruthy();
  expect(screen.getByText('Out of date')).toBeTruthy();
  expect(screen.getByText('<script>caption</script>')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Open analysis provenance' }).getAttribute('href'),
  ).toContain(`execution=${executionId}`);
  expect(api.fetchExecutionRecord).toHaveBeenCalledWith(
    'w',
    analysisId,
    executionId,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'View provenance' }));
  expect(await screen.findByRole('dialog', { name: 'Analysis provenance' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Update reference' }));
  expect(update).toHaveBeenCalledTimes(1);
});
test('table and summary modes render inert persisted values and hide editing for viewers', async () => {
  const view = mount(
    <ReferencedOutput
      workspaceId="w"
      reference={{ ...reference, outputId: 'impedance-table', renderMode: 'TABLE' }}
      caption=""
      canEdit={false}
      onUpdate={jest.fn()}
    />,
  );
  expect(await screen.findByText('2000')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update reference' })).toBeNull();
  view.rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReferencedOutput
          workspaceId="w"
          reference={{ ...reference, outputId: 'notes', renderMode: 'SUMMARY' }}
          caption="Saved summary"
          canEdit={false}
          onUpdate={jest.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.getByText('Calculated from the selected immutable version.'),
  ).toBeTruthy();
});
test('missing and wrong-mode outputs never substitute another execution or output', async () => {
  mount(
    <ReferencedOutput
      workspaceId="w"
      reference={{ ...reference, outputId: 'impedance-table' }}
      caption=""
      canEdit={false}
      onUpdate={jest.fn()}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'selected saved output is unavailable',
  );
  expect(screen.queryByRole('table')).toBeNull();
});
test('failed lookup and unavailable source freshness leave provenance metadata intact', async () => {
  jest.mocked(api.fetchExecutionRecord).mockRejectedValue(new Error('private detail'));
  jest.mocked(sources.fetchSources).mockRejectedValue(new Error('private detail'));
  mount(
    <ReferencedOutput
      workspaceId="w"
      reference={reference}
      caption=""
      canEdit={false}
      onUpdate={jest.fn()}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load referenced result',
  );
  expect(await screen.findByText(/Source freshness could not be checked/)).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Open analysis provenance' }).getAttribute('href'),
  ).toContain(executionId);
});
test('a real editor node keeps its reference across reload and changes only with an explicit selection', async () => {
  const change = jest.fn();
  const content = {
    type: 'doc' as const,
    content: [analysisBlock(reference, 'Figure caption', blockId), { type: 'paragraph' }],
  };
  mount(
    <DocumentBodyEditor
      workspaceId="w"
      initialContent={content}
      editable
      onChange={change}
      label="Report body"
    />,
  );
  expect(await screen.findByAltText('Impedance magnitude versus frequency')).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update reference' }));
  expect(await screen.findByText('impedance-chart (CHART)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel update' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update reference' }));
  await screen.findByText(/Attempt 2/);
  fireEvent.change(screen.getByLabelText('Execution'), { target: { value: newerId } });
  await waitFor(() =>
    expect(api.fetchExecutionRecord).toHaveBeenCalledWith(
      'w',
      analysisId,
      newerId,
      expect.any(AbortSignal),
    ),
  );
  await screen.findByText('impedance-table (TABLE)');
  fireEvent.change(screen.getByLabelText('Output'), {
    target: { value: 'impedance-table' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Use selected output' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use selected output' }));
  await waitFor(() => expect(change).toHaveBeenCalled());
  expect(change.mock.calls.at(-1)?.[0].content[0].attrs.reference).toEqual({
    ...reference,
    executionId: newerId,
    outputId: 'impedance-table',
    renderMode: 'TABLE',
  });
  expect(await screen.findByText('2000')).toBeTruthy();
});
test('a node cannot fetch without the workspace binding from its editor', async () => {
  mount(
    <DocumentBodyEditor
      initialContent={{ type: 'doc', content: [analysisBlock(reference, '', blockId)] }}
      editable={false}
      onChange={jest.fn()}
      label="Report"
    />,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(api.fetchExecutionRecord).not.toHaveBeenCalled();
});
test('authorization changes update block controls without editing the report', async () => {
  const change = jest.fn();
  const content = {
    type: 'doc' as const,
    content: [analysisBlock(reference, '', blockId), { type: 'paragraph' }],
  };
  const body = (editable: boolean): ReactElement => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DocumentBodyEditor
          workspaceId="w"
          initialContent={content}
          editable={editable}
          onChange={change}
          label="Report"
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(body(false));
  await screen.findByAltText('Impedance magnitude versus frequency');
  expect(screen.queryByRole('button', { name: 'Update reference' })).toBeNull();
  view.rerender(body(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Update reference' }));
  await screen.findByRole('button', { name: 'Use selected output' });
  view.rerender(body(false));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Update reference' })).toBeNull(),
  );
  expect(screen.queryByRole('button', { name: 'Use selected output' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
test('document source sidebar links saved analysis blocks to historical provenance', () => {
  const attrs = { blockId, reference, caption: '' };
  mount(
    <DocumentSources
      workspaceId="w"
      analyses={[{ position: 0, attrs }]}
      references={[]}
      sources={[]}
      citationHref={() => '/source'}
      loading={false}
      error={null}
    />,
  );
  expect(
    screen.getByRole('link', { name: 'impedance-chart' }).getAttribute('href'),
  ).toContain(executionId);
});
