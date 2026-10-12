/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { apiClient } from '../../../shared/api';
import * as sources from '../../sources/api/sourceApi';
import * as analyses from '../../analysis/api/analysisApi';
import * as solutions from '../../analysis/api/solutionApi';
import { semanticRecord, reference } from '../../analysis/testing/semanticFixtures';
import solutionFixture from '../../../../../contracts/analysis/execution/v3/solution.json';
import { CitationReference, type PreviewCitation } from '../../ai/components/Citations';
import {
  ProvenancePanel,
  ProvenanceProvider,
  type ProvenanceTarget,
} from './ProvenancePanel';
import type { OriginOperation } from './DocumentProvenance';
const citation: PreviewCitation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'v',
  processingVersion: 'p1',
  contentHash: 'b'.repeat(64),
  chunkId: 'a'.repeat(64),
  title: 'Paper',
  pageStart: 7,
  pageEnd: 8,
  sectionTitle: null,
  spans: [{ unitId: 'page-7', characterStart: 0, characterEnd: 7 }],
};
const operation: OriginOperation = {
  id: 'op',
  blockId: 'block',
  category: 'AI_GENERATED',
  actorUserId: 'u',
  actorName: 'Approver',
  operationType: 'AI_ACCEPTED',
  sourceOperationId: 'suggestion',
  documentRevision: 7,
  createdAt: '2026-10-06T12:00:00Z',
  metadata: {
    model: { name: 'model', version: 'v2' },
    templateId: 'template-v3',
    templateHash: 'c'.repeat(64),
  },
};
function mount(child: ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      }
    >
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}
function panel(target: ProvenanceTarget | null) {
  const close = jest.fn();
  mount(<ProvenancePanel target={target} onClose={close} />);
  return close;
}
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  jest.spyOn(sources, 'fetchSourceVersions').mockResolvedValue([
    {
      id: 'v',
      originalFilename: 'immutable.pdf',
      versionNumber: 3,
      contentSha256: 'd'.repeat(64),
    },
  ] as never);
  jest.spyOn(analyses, 'fetchExecutionRecord').mockResolvedValue(semanticRecord());
  jest
    .spyOn(solutions, 'fetchSolution')
    .mockResolvedValue(solutionFixture as unknown as solutions.SolutionBundle);
  jest.spyOn(apiClient, 'get').mockResolvedValue([operation]);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
it('shows immutable citation version, locator and hashes and preserves the exact reader link', async () => {
  const close = panel({ kind: 'citation', citation });
  expect(screen.getByRole('status').textContent).toContain('Loading');
  await screen.findByText('immutable.pdf');
  expect(screen.getByText('v · v3')).toBeTruthy();
  expect(screen.getByText('Page 7–8')).toBeTruthy();
  expect(screen.getByText('b'.repeat(64))).toBeTruthy();
  expect(screen.getByText('d'.repeat(64))).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: 'Open source reader at this version' })
      .getAttribute('href'),
  ).toContain('version=v');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalled();
});
it('supports legacy citations, fragment locators and missing metadata without substituting latest', async () => {
  panel({
    kind: 'citation',
    citation: {
      ...citation,
      sourceVersionId: null,
      title: null,
      pageStart: null,
      pageEnd: null,
      spans: [],
      sectionTitle: null,
    },
  });
  await screen.findByText('Not recorded for this legacy citation');
  expect(sources.fetchSourceVersions).not.toHaveBeenCalled();
  expect(screen.getAllByText('Not recorded')).toHaveLength(3);
  cleanup();
  panel({
    kind: 'citation',
    citation: { ...citation, pageStart: null, pageEnd: null, sectionTitle: 'Section A' },
  });
  expect(await screen.findByText('Section A')).toBeTruthy();
  cleanup();
  panel({
    kind: 'citation',
    citation: { ...citation, pageStart: null, pageEnd: null, sectionTitle: null },
  });
  expect(await screen.findByText('page-7')).toBeTruthy();
});
it('reports missing versions and source errors', async () => {
  jest.mocked(sources.fetchSourceVersions).mockResolvedValueOnce([]);
  panel({ kind: 'citation', citation: { ...citation, pageEnd: 7 } });
  await screen.findByText('The immutable source version is unavailable.');
  expect(screen.getByText('Page 7')).toBeTruthy();
  cleanup();
  jest
    .mocked(sources.fetchSourceVersions)
    .mockRejectedValueOnce(new Error('Unavailable'));
  panel({ kind: 'citation', citation });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load source provenance',
  );
});
it('shows model and template versions with the approving actor and recorded time', async () => {
  panel({ kind: 'block', workspaceId: 'w', documentId: 'd', blockId: 'block' });
  await screen.findByText('model');
  expect(screen.getByText('v2')).toBeTruthy();
  expect(screen.getByText('template-v3')).toBeTruthy();
  expect(screen.getByText('Approver · u')).toBeTruthy();
  expect(screen.getByText('Approved at')).toBeTruthy();
  expect(document.querySelector('time')?.getAttribute('datetime')).toBe(
    operation.createdAt,
  );
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w/documents/d/blocks/block/provenance',
    expect.anything(),
  );
});
it('shows absent, empty and failed block provenance and human operations', async () => {
  panel({ kind: 'block', workspaceId: 'w', documentId: 'd', blockId: null });
  expect(screen.getByText('No origin was recorded for this legacy block.')).toBeTruthy();
  cleanup();
  jest.mocked(apiClient.get).mockResolvedValueOnce([]);
  panel({ kind: 'block', workspaceId: 'w', documentId: 'd', blockId: 'block' });
  await screen.findByText('No saved provenance for this block.');
  cleanup();
  jest.mocked(apiClient.get).mockRejectedValueOnce(new Error('Unavailable'));
  panel({ kind: 'block', workspaceId: 'w', documentId: 'd', blockId: 'block' });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load block provenance',
  );
  cleanup();
  jest
    .mocked(apiClient.get)
    .mockResolvedValueOnce([
      { ...operation, actorUserId: null, operationType: 'EDITED', metadata: {} },
    ]);
  panel({ kind: 'block', workspaceId: 'w', documentId: 'd', blockId: 'block' });
  await screen.findByText('Actor');
  expect(screen.getByText('Approver · System')).toBeTruthy();
  expect(screen.getAllByText('Not recorded')).toHaveLength(3);
});
it('shows analysis inputs, generated code, runtime, duration, outputs and rerun origin', async () => {
  const record = semanticRecord();
  record.snapshot.lineage = {
    originAnalysisId: 'original-analysis',
    originExecutionId: 'original-run',
    inputMode: 'ORIGINAL',
    versions: [],
    requestedRuntime: null,
  };
  jest.mocked(analyses.fetchExecutionRecord).mockResolvedValueOnce(record);
  panel({ kind: 'analysis', workspaceId: 'w', reference });
  expect(screen.getByRole('status').textContent).toContain('Loading');
  await screen.findByText('Re-run origin');
  expect(
    screen
      .getByRole('link', { name: 'Original execution original-run' })
      .getAttribute('href'),
  ).toContain('execution=original-run');
  expect(screen.getByText('Generated Python')).toBeTruthy();
  expect(screen.getByText('Duration')).toBeTruthy();
  expect(screen.getByText('Image')).toBeTruthy();
  expect(screen.getByText('Saved outputs')).toBeTruthy();
});
it('reports analysis failure', async () => {
  jest
    .mocked(analyses.fetchExecutionRecord)
    .mockRejectedValueOnce(new Error('Unavailable'));
  panel({ kind: 'analysis', workspaceId: 'w', reference });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load analysis provenance',
  );
});
it('supports existing scientific solution provenance and empty outputs', async () => {
  panel({
    kind: 'analysis',
    workspaceId: 'w',
    reference: { ...reference, workload: 'PROBLEM' },
  });
  await screen.findByText('Scientific analysis provenance');
  expect(screen.getByText('Original execution')).toBeTruthy();
  expect(screen.getByText('Generated code hashes')).toBeTruthy();
  expect(screen.getByText('Not recorded in this solution contract')).toBeTruthy();
  cleanup();
  jest.mocked(solutions.fetchSolution).mockResolvedValueOnce({
    ...solutionFixture,
    origin: { executionId: 'original' },
    outputs: [],
  } as unknown as solutions.SolutionBundle);
  panel({
    kind: 'analysis',
    workspaceId: 'w',
    reference: { ...reference, workload: 'PROBLEM' },
  });
  await screen.findByText('None');
  expect(screen.getByText(/"executionId": "original"/)).toBeTruthy();
});
it('uses one common panel in two clicks and returns keyboard focus to the citation', async () => {
  mount(
    <ProvenanceProvider>
      <CitationReference citation={citation} number={1} quote="Saved quotation" />
    </ProvenanceProvider>,
  );
  const chip = screen.getByRole('link');
  chip.focus();
  fireEvent.click(chip);
  const popup = await screen.findByRole('dialog', { name: 'Citation 1' });
  fireEvent.click(within(popup).getByRole('button', { name: 'Show provenance' }));
  await screen.findByRole('dialog', { name: 'Provenance' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await screen.findByText('immutable.pdf');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(chip);
});
it('supports citation provenance outside a document provider', async () => {
  mount(<CitationReference citation={citation} number={1} quote="Saved quotation" />);
  fireEvent.click(screen.getByRole('link'));
  fireEvent.click(screen.getByRole('button', { name: 'Show provenance' }));
  await screen.findByRole('dialog', { name: 'Provenance' });
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Provenance' })).getByRole('button', {
      name: 'Close',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Provenance' })).toBeNull(),
  );
});
it('does not render a closed panel', () => {
  panel(null);
  expect(screen.queryByRole('dialog')).toBeNull();
});
