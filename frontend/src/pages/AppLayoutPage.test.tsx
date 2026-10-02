/** @jest-environment jsdom */
import { useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppLayoutPage } from './AppLayoutPage';
import { queryKeys } from '../shared/api';
import type { Workspace } from '../features/workspaces/api/workspaceApi';

const user = {
  id: 'adam',
  displayName: 'Adam Nowak',
  email: 'adam@uni.edu',
  status: 'ACTIVE',
};
const workspace: Workspace = {
  id: 'w1',
  name: 'Electronics Lab — Team 4',
  description: null,
  role: 'OWNER',
  archivedAt: null,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};
const mounts = jest.fn();
function Page() {
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const location = useLocation();
  useEffect(() => {
    mounts();
  }, []);
  return (
    <section>
      <h1>Existing page</h1>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {[
        'workspace-documents',
        'workspace-sources',
        'workspace-questions',
        'workspace-members',
        'edit-workspace',
        'create-workspace',
        'create-document',
        'upload-source',
        'add-member',
      ].map((id) => (
        <h2 key={id} id={`${id}-heading`}>
          {id}
        </h2>
      ))}
      <button onClick={() => setReveal(true)}>Reveal section</button>
      {reveal ? <h2 id="delayed">Delayed section</h2> : null}
      <output aria-label="Location">
        {location.pathname}
        {location.hash}
      </output>
    </section>
  );
}
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}
interface Options {
  readonly workspace?: Workspace;
  readonly list?: readonly Workspace[];
  readonly failures?: readonly string[];
  readonly members?: number;
  readonly user?: typeof user | null;
  readonly pendingWorkspace?: Promise<Response>;
}
function setup(path = '/app/workspaces/w1', options: Options = {}) {
  const failures = new Set(options.failures);
  const active = options.workspace ?? workspace;
  const fetch = jest.fn((url: unknown) => {
    const route = String(url);
    if (failures.has(route))
      return Promise.resolve(
        response(
          {
            type: 'about:blank',
            title: 'Unavailable',
            status: route === '/api/workspaces/w1' ? 404 : 500,
            detail: 'Not available.',
            code:
              route === '/api/workspaces/w1' ? 'RESOURCE_NOT_FOUND' : 'INTERNAL_ERROR',
          },
          route === '/api/workspaces/w1' ? 404 : 500,
        ),
      );
    if (route === '/api/me')
      return Promise.resolve(response(options.user === undefined ? user : options.user));
    if (route === '/api/workspaces')
      return Promise.resolve(
        response(
          options.list ?? [
            active,
            { ...workspace, id: 'w2', name: 'Second workspace', role: 'VIEWER' },
          ],
        ),
      );
    if (route === '/api/workspaces/w1')
      return options.pendingWorkspace ?? Promise.resolve(response(active));
    if (route === '/api/workspaces/w2')
      return Promise.resolve(
        response({ ...workspace, id: 'w2', name: 'Second workspace', role: 'VIEWER' }),
      );
    if (route.endsWith('/members'))
      return Promise.resolve(
        response(
          Array.from({ length: options.members ?? 3 }, (_, index) => ({
            userId: `user-${index}`,
            displayName: `Member ${index}`,
            email: `member-${index}@uni.edu`,
            role: 'VIEWER',
          })),
        ),
      );
    if (route.endsWith('/documents'))
      return Promise.resolve(
        response([
          { id: 'doc', title: 'Laboratory Report' },
          { id: 'notes', title: 'Research Notes' },
        ]),
      );
    if (route.endsWith('/sources'))
      return Promise.resolve(
        response([
          { id: 'source', displayName: 'smith_2025.pdf', status: 'READY' },
          { id: 'processing', displayName: 'calibration.xlsx', status: 'PROCESSING' },
          { id: 'failed', status: 'FAILED' },
        ]),
      );
    throw new Error(`Unexpected request: ${route}`);
  });
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<AppLayoutPage />}>
            <Route index element={<Page />} />
            <Route path="workspaces" element={<Page />} />
            <Route path="workspaces/:workspaceId" element={<Page />} />
            {['documents', 'sources', 'ask', 'members', 'settings'].map((section) => (
              <Route
                key={section}
                path={`workspaces/:workspaceId/${section}`}
                element={<Page />}
              />
            ))}
            <Route
              path="workspaces/:workspaceId/documents/:documentId"
              element={<Page />}
            />
            <Route path="workspaces/:workspaceId/sources/:sourceId" element={<Page />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client, fetch, failures };
}
function navigation() {
  return screen.getByRole('navigation', { name: 'Application navigation' });
}
function currentBreadcrumb() {
  return screen
    .getByRole('navigation', { name: 'Breadcrumb' })
    .querySelector('[aria-current="page"]')!;
}
beforeEach(() => mounts.mockClear());

it('renders landmarks, server counts, role, member identities and ready-source grounding', async () => {
  const { fetch } = setup();
  await screen.findByText('Grounded in 1 source');
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(within(navigation()).getByRole('link', { name: 'Documents 2' })).toBeTruthy();
  expect(within(navigation()).getByRole('link', { name: 'Sources 3' })).toBeTruthy();
  expect(
    within(navigation())
      .getByRole('link', { name: 'Overview' })
      .getAttribute('aria-current'),
  ).toBe('page');
  expect(screen.getByText('Owner · 3 members')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Workspace members' }).children).toHaveLength(
    3,
  );
  expect(screen.getByTitle('adam@uni.edu')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  for (const absent of ['Search', 'Analyses', 'Help', 'Notifications'])
    expect(screen.queryByRole('link', { name: absent })).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('/health'))).toBe(false);
});
it('focuses existing sections from navigation and action slots, including repeated activation', async () => {
  setup();
  await screen.findByText('Grounded in 1 source');
  for (const [link, heading, action, actionHeading] of [
    [
      'Documents 2',
      'workspace-documents-heading',
      'New document',
      'create-document-heading',
    ],
    ['Sources 3', 'workspace-sources-heading', 'Upload source', 'upload-source-heading'],
    ['Members', 'workspace-members-heading', 'Add member', 'add-member-heading'],
  ]) {
    fireEvent.click(within(navigation()).getByRole('link', { name: link! }));
    await waitFor(() => expect(document.activeElement?.id).toBe(heading));
    fireEvent.click(screen.getByRole('button', { name: action! }));
    await waitFor(() => expect(document.activeElement?.id).toBe(actionHeading));
    screen.getByRole('button', { name: action! }).focus();
    fireEvent.click(screen.getByRole('button', { name: action! }));
    await waitFor(() => expect(document.activeElement?.id).toBe(actionHeading));
  }
  fireEvent.click(within(navigation()).getByRole('link', { name: 'Ask AI' }));
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('workspace-questions-heading'),
  );
  expect(currentBreadcrumb().textContent).toBe('Ask AI');
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  await waitFor(() => expect(document.activeElement?.id).toBe('edit-workspace-heading'));
  expect(currentBreadcrumb().textContent).toBe('Settings');
  fireEvent.click(within(navigation()).getByRole('link', { name: 'Overview' }));
  expect(currentBreadcrumb().textContent).toBe('Overview');
});
it.each([
  ['documents/doc', 'Laboratory Report', 'Documents'],
  ['sources/source', 'smith_2025.pdf', 'Sources'],
  ['documents/unknown', 'Document', 'Documents'],
  ['sources/unknown', 'Source', 'Sources'],
])(
  'keeps %s inside the shell and resolves its breadcrumb from lists',
  async (path, title, selected) => {
    setup(`/app/workspaces/w1/${path}`);
    await waitFor(() => expect(currentBreadcrumb().textContent).toBe(title));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(
      within(navigation())
        .getByRole('link', { name: new RegExp(`^${selected}`) })
        .getAttribute('aria-current'),
    ).toBe('page');
  },
);
it.each([
  ['VIEWER', null],
  ['EDITOR', null],
  ['OWNER', '2026-10-01'],
])('omits unavailable management for %s archivedAt=%s', async (role, archivedAt) => {
  setup('/app/workspaces/w1', { workspace: { ...workspace, role, archivedAt } });
  await screen.findByText('Grounded in 1 source');
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
  expect(Boolean(screen.queryByRole('button', { name: 'New document' }))).toBe(
    role === 'EDITOR' && archivedAt === null,
  );
});
it('switches workspace without retaining the previous role or actions', async () => {
  setup();
  await screen.findByText('Owner · 3 members');
  fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
    target: { value: 'w2' },
  });
  await screen.findByText('Viewer · 3 members');
  expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
});
it('shows archived current workspaces missing from the active list, with a singular member count', async () => {
  setup('/app/workspaces/w1', {
    workspace: { ...workspace, archivedAt: '2026-10-01' },
    list: [],
    members: 1,
  });
  await screen.findByText('Owner · 1 member');
  expect(screen.getByRole('option', { name: workspace.name })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Workspace members' })).toBeNull();
});
it.each(['/app', '/app/workspaces'])(
  'keeps %s in the frame and opens the shared create dialog',
  async (path) => {
    const { fetch } = setup(path, { list: [] });
    await screen.findByText(/No workspace yet/);
    expect(currentBreadcrumb().textContent).toBe(path === '/app' ? 'Home' : 'Workspaces');
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' });
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'New workspace' }),
    );
    const sidebarOpener = screen.getByRole('button', { name: 'Create workspace' });
    fireEvent.click(sidebarOpener);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(sidebarOpener);
    expect(
      fetch.mock.calls.every(([url]) =>
        ['/api/me', '/api/workspaces'].includes(String(url)),
      ),
    ).toBe(true);
  },
);
it('withholds context and collection queries for a rejected workspace', async () => {
  const { fetch } = setup('/app/workspaces/w1', {
    list: [],
    failures: ['/api/workspaces/w1'],
  });
  await screen.findByText(/No workspace yet/);
  expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull();
  expect(currentBreadcrumb().textContent).toBe('Workspace');
  expect(
    fetch.mock.calls.some(([url]) => /\/(documents|sources|members)$/.test(String(url))),
  ).toBe(false);
});
it('keeps failed counts unknown and hides failed member identities', async () => {
  setup('/app/workspaces/w1', {
    failures: [
      '/api/workspaces/w1/documents',
      '/api/workspaces/w1/sources',
      '/api/workspaces/w1/members',
    ],
  });
  await screen.findByRole('link', { name: 'Overview' });
  await waitFor(() =>
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('w1'),
  );
  expect(within(navigation()).getByRole('link', { name: 'Documents' })).toBeTruthy();
  expect(within(navigation()).getByRole('link', { name: 'Sources' })).toBeTruthy();
  expect(screen.queryByText(/Grounded/)).toBeNull();
  expect(screen.queryByRole('group', { name: 'Workspace members' })).toBeNull();
});
it('offers retry after a failed workspace collection', async () => {
  const { failures } = setup('/app', { failures: ['/api/workspaces'] });
  await screen.findByText(/Workspaces unavailable\./);
  failures.clear();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('option', { name: workspace.name });
  expect(screen.queryByText(/Workspaces unavailable\./)).toBeNull();
});
it('focuses delayed sections and cleans up an absent-section observer', async () => {
  const { unmount } = setup('/app#delayed');
  await screen.findByRole('main');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal section' }));
  await waitFor(() => expect(document.activeElement?.id).toBe('delayed'));
  unmount();
  const other = setup('/app#missing');
  await screen.findByRole('main');
  other.unmount();
});
it('retains unsaved outlet state as context resolves and fails on refresh', async () => {
  let resolveWorkspace!: (value: Response) => void;
  const pendingWorkspace = new Promise<Response>((resolve) => {
    resolveWorkspace = resolve;
  });
  const { client, failures } = setup('/app/workspaces/w1', { pendingWorkspace });
  const draft = await screen.findByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Keep my text' } });
  await act(async () => {
    resolveWorkspace(response(workspace));
  });
  await screen.findByText('Grounded in 1 source');
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  failures.add('/api/workspaces/w1');
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.workspace('w1'), exact: true });
  });
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull(),
  );
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe('Keep my text');
  expect(mounts).toHaveBeenCalledTimes(1);
});
it('does not render a shell without a resolved session', async () => {
  setup('/app', { user: null });
  await act(async () => {});
  expect(screen.queryByRole('main')).toBeNull();
});

it('preserves unfamiliar server roles and shows zero ready sources accurately', async () => {
  const { client } = setup('/app/workspaces/w1', {
    workspace: { ...workspace, role: 'REVIEWER' },
  });
  await screen.findByText('REVIEWER · 3 members');
  await act(async () => {
    client.setQueryData(queryKeys.sources('w1'), []);
  });
  await screen.findByText('Grounded in 0 sources');
  expect(within(navigation()).getByRole('link', { name: 'Sources 0' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'New document' })).toBeNull();
});
