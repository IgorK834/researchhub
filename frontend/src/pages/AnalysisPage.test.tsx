/** @jest-environment jsdom */
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnalysisPage } from './AnalysisPage';
import { useWorkspaceQuery } from '../features/workspaces/api/useWorkspaces';
import { useSourcesQuery } from '../features/sources/api/useSources';
import type { DatasetChoice } from '../features/analysis/api/analysisApi';

jest.mock('../features/workspaces/api/useWorkspaces', () => ({
  useWorkspaceQuery: jest.fn(),
}));
jest.mock('../features/sources/api/useSources', () => ({ useSourcesQuery: jest.fn() }));
jest.mock('../features/analysis/components/AnalysisStudio', () => ({
  AnalysisStudio: ({ analysisId, canEdit }: { analysisId: string; canEdit: boolean }) => (
    <p>
      Studio {analysisId} · {canEdit ? 'editable' : 'read-only'}
    </p>
  ),
}));
jest.mock('../features/analysis/components/NewAnalysis', () => ({
  NewAnalysis: ({
    datasets,
    initialVersionId,
    onCreated,
  }: {
    datasets: readonly DatasetChoice[];
    initialVersionId?: string;
    onCreated: (id: string) => void;
  }) => (
    <section>
      <h1>New computation</h1>
      <p>{datasets.map((d) => d.label).join(', ')}</p>
      <p>{initialVersionId ?? 'No preselection'}</p>
      <button onClick={() => onCreated('saved')}>Complete</button>
    </section>
  ),
}));
function Location() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}
function mount(path = '/app/workspaces/w/analyses/a') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/app/workspaces/:workspaceId/analyses/:analysisId"
          element={<AnalysisPage />}
        />
        <Route path="/no-params" element={<AnalysisPage />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}
const workspace = { id: 'w', role: 'OWNER', archivedAt: null };
beforeEach(() => {
  jest
    .mocked(useWorkspaceQuery)
    .mockReturnValue({ data: workspace, error: null, isPending: false } as never);
  jest
    .mocked(useSourcesQuery)
    .mockReturnValue({ data: [], error: null, isPending: false } as never);
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});
it('gates direct URLs on workspace authorization and avoids current source reads for historical records', () => {
  mount();
  expect(screen.getByText('Studio a · editable')).not.toBeNull();
  expect(useSourcesQuery).toHaveBeenCalledWith('w', false);
});
it.each([
  { role: 'VIEWER', archivedAt: null },
  { role: 'OWNER', archivedAt: '2026-10-01' },
])('passes read-only capabilities for %o', (w) => {
  jest.mocked(useWorkspaceQuery).mockReturnValue({
    data: { ...workspace, ...w },
    error: null,
    isPending: false,
  } as never);
  mount();
  expect(screen.getByText('Studio a · read-only')).not.toBeNull();
});
it('hides creation from read-only users', () => {
  jest.mocked(useWorkspaceQuery).mockReturnValue({
    data: { ...workspace, role: 'VIEWER' },
    error: null,
    isPending: false,
  } as never);
  mount('/app/workspaces/w/analyses/new');
  expect(screen.getByText('This workspace is read-only for you.')).not.toBeNull();
  expect(screen.queryByText('New computation')).toBeNull();
});
it('handles missing params, loading and inaccessible workspaces', () => {
  mount('/no-params');
  expect(screen.getByText('Analysis unavailable.')).not.toBeNull();
  cleanup();
  jest
    .mocked(useWorkspaceQuery)
    .mockReturnValue({ isPending: true, error: null } as never);
  mount();
  expect(screen.getByText('Loading workspace…')).not.toBeNull();
  cleanup();
  jest
    .mocked(useWorkspaceQuery)
    .mockReturnValue({ isPending: false, error: new Error('Unavailable') } as never);
  mount();
  expect(screen.getByRole('alert').textContent).toContain('Analysis unavailable');
});
it('uses only ready scientific versions and navigates to the durable result on creation', () => {
  jest.mocked(useSourcesQuery).mockReturnValue({
    isPending: false,
    error: null,
    data: [
      {
        id: 's',
        activeVersionId: 'v3',
        activeVersionNumber: 3,
        displayName: 'measurement',
        status: 'READY',
        sourceType: 'CSV',
      },
      {
        id: 't',
        activeVersionId: 'v4',
        activeVersionNumber: 4,
        displayName: 'workbook',
        status: 'READY',
        sourceType: 'XLSX',
      },
      { status: 'READY', sourceType: 'PDF' },
      { status: 'PROCESSING', sourceType: 'CSV' },
    ],
  } as never);
  mount('/app/workspaces/w/analyses/new?version=v4');
  expect(screen.getByText('measurement · v3, workbook · v4')).not.toBeNull();
  expect(screen.getByText('v4')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
  expect(screen.getByText('/app/workspaces/w/analyses/saved')).not.toBeNull();
});
it('handles unavailable datasets and an unselected empty collection', () => {
  jest.mocked(useSourcesQuery).mockReturnValue({ isPending: true, error: null } as never);
  mount('/app/workspaces/w/analyses/new');
  expect(screen.getByText('Loading datasets…')).not.toBeNull();
  cleanup();
  jest
    .mocked(useSourcesQuery)
    .mockReturnValue({ isPending: false, error: new Error('No access') } as never);
  mount('/app/workspaces/w/analyses/new');
  expect(screen.getByRole('alert').textContent).toContain('Could not load datasets');
  cleanup();
  jest
    .mocked(useSourcesQuery)
    .mockReturnValue({ data: [], isPending: false, error: null } as never);
  mount('/app/workspaces/w/analyses/new');
  expect(screen.getByText('No preselection')).not.toBeNull();
});
