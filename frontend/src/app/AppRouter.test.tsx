/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppRouter, appRoutes } from './AppRouter';
import { desktopMedia } from '../shared/testing/desktopMedia';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';
import { SourceRoutePage } from '../pages/SourceRoutePage';

// Feature behavior and immutable citations are covered by their existing page/flow tests.
// Here the actual route tree, section pages, shell and responsive source overlay are exercised.
jest.mock('../pages/SourceDetailPage', () => ({
  SourceDetailPage: ({ embedded }: { embedded?: boolean }) => {
    const router =
      jest.requireActual<typeof import('react-router-dom')>('react-router-dom');
    const location = router.useLocation();
    const { sourceId } = router.useParams();
    return (
      <section aria-label={embedded ? undefined : 'Source reader'}>
        <h1>Source {sourceId}</h1>
        <output aria-label="Source query">{location.search}</output>
        <input aria-label="Source action" />
      </section>
    );
  },
}));
jest.mock('../pages/DocumentDetailPage', () => ({
  DocumentDetailPage: () => {
    const { documentId } = jest
      .requireActual<typeof import('react-router-dom')>('react-router-dom')
      .useParams();
    return <h1>Document {documentId}</h1>;
  },
}));
const user = {
  id: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@uni.edu',
  status: 'ACTIVE',
};
const workspace = {
  id: 'w1',
  name: 'Electronics Lab',
  description: 'Team 4',
  role: 'OWNER',
  archivedAt: null,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};
function json(body: unknown, status = 200): Response {
  return {
    ok: status === 200,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}
const originalFetch = globalThis.fetch;
const originalRequest = globalThis.Request;
const originalAbortController = globalThis.AbortController;
const originalAbortSignal = globalThis.AbortSignal;
const nativeVm = jest.requireActual<typeof import('node:vm')>('node:vm');
const NativeAbortController = nativeVm.runInThisContext(
  'AbortController',
) as typeof AbortController;
const NativeAbortSignal = nativeVm.runInThisContext('AbortSignal') as typeof AbortSignal;
const NativeRequest = jest
  .requireActual<typeof import('node:vm')>('node:vm')
  .runInThisContext('Request') as typeof Request;
beforeEach(() => {
  globalThis.Request = NativeRequest;
  globalThis.AbortController = NativeAbortController;
  globalThis.AbortSignal = NativeAbortSignal;
  globalThis.fetch = jest.fn((url: unknown) => {
    const path = String(url);
    if (path === '/api/me') return Promise.resolve(json(user));
    if (path === '/api/workspaces') return Promise.resolve(json([workspace]));
    if (path === '/api/workspaces/w1') return Promise.resolve(json(workspace));
    if (path.endsWith('/members'))
      return Promise.resolve(
        json([
          {
            userId: user.id,
            displayName: user.displayName,
            email: user.email,
            role: 'OWNER',
          },
        ]),
      );
    if (path.includes('/conversations'))
      return Promise.resolve(json({ items: [], nextOffset: null }));
    return Promise.resolve(json([]));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Request = originalRequest;
  globalThis.AbortController = originalAbortController;
  globalThis.AbortSignal = originalAbortSignal;
});
function setup(path: string, routes = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

it.each([
  ['', 'Overview', 'Recent documents'],
  ['/documents', 'Documents', 'Documents'],
  ['/sources', 'Sources', 'Sources'],
  ['/ask', 'Ask AI', 'Ask AI'],
  ['/analyses', 'Analyses', 'Analyses'],
  ['/members', 'Members', 'Members table'],
  ['/settings', 'Settings', 'General'],
])(
  'opens section %s directly and marks its sidebar entry',
  async (suffix, name, content) => {
    setup(`/app/workspaces/w1${suffix}`);
    await screen.findByRole('heading', {
      name:
        suffix === '/documents' ||
        suffix === '/sources' ||
        suffix === '/ask' ||
        suffix === '/analyses'
          ? name
          : suffix === '/members'
            ? 'Members'
            : suffix === '/settings'
              ? 'Settings'
              : workspace.name,
    });
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const entry =
      within(
        screen.getByRole('navigation', { name: 'Application navigation' }),
      ).queryByRole('link', { name: new RegExp(`^${name}`) }) ??
      screen.getByRole('link', { name });
    expect(entry.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('region', { name: content })).toBeTruthy();
    if (suffix !== '/members')
      expect(screen.queryByRole('button', { name: 'Remove Ada Lovelace' })).toBeNull();
  },
);

it('navigates all six sidebar destinations and keeps page content isolated', async () => {
  const router = setup('/app/workspaces/w1');
  await screen.findByRole('heading', { name: workspace.name });
  for (const [label, suffix] of [
    ['Documents', 'documents'],
    ['Sources', 'sources'],
    ['Ask AI', 'ask'],
    ['Members', 'members'],
    ['Settings', 'settings'],
    ['Overview', ''],
  ] as const) {
    const link = screen.getAllByRole('link', {
      name: new RegExp(`^${label}(?: \\d+)?$`),
    })[0]!;
    fireEvent.click(link);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/workspaces/w1${suffix ? `/${suffix}` : ''}`,
      ),
    );
  }
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
});

it('redirects legacy Analyze links without dropping query parameters', async () => {
  const query =
    '?analyzeSource=s1&analyzeVersion=v2&analyzeSheet=Sheet+1&page=7&unit=u1&version=v2&processingVersion=p3';
  const router = setup(`/app/workspaces/w1${query}`);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/app/workspaces/w1/ask'),
  );
  expect(router.state.location.search).toBe(query);
  expect(router.state.historyAction).toBe('REPLACE');
});
it('redirects legacy section fragments, preserving their query and focus target', async () => {
  const router = setup('/app/workspaces/w1?version=v2#create-document-heading');
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/app/workspaces/w1/documents'),
  );
  expect(router.state.location.search).toBe('?version=v2');
  await waitFor(() => expect(document.activeElement?.id).toBe('create-document-heading'));
});
it.each(['unknown', 'activity', 'sources/s1/unknown', 'documents/d1/unknown'])(
  'renders Not Found for unknown section %s',
  async (section) => {
    setup(`/app/workspaces/w1/${section}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go back home' }).getAttribute('href')).toBe(
      '/app',
    );
  },
);
it('keeps document and citation URLs unchanged', async () => {
  const router = setup('/app/workspaces/w1/documents/d1');
  expect(await screen.findByRole('heading', { name: 'Document d1' })).toBeTruthy();
  const query = '?page=14&unit=u1&version=v2&processingVersion=p2';
  await act(() => router.navigate(`/app/workspaces/w1/sources/s1${query}`));
  expect(await screen.findByRole('heading', { name: 'Source s1' })).toBeTruthy();
  expect(screen.getByLabelText('Source query').textContent).toBe(query);
  expect(screen.getByRole('region', { name: 'Source reader' })).toBeTruthy();
});
it('opens a refreshed citation in a narrow library slide-over and closes to Sources', async () => {
  const media = desktopMedia(true);
  try {
    const router = setup('/app/workspaces/w1/sources/s1?page=14&version=v2');
    const dialog = await screen.findByRole('dialog', { name: 'Source details' });
    expect(within(dialog).getByLabelText('Source query').textContent).toBe(
      '?page=14&version=v2',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/app/workspaces/w1/sources'),
    );
    await waitFor(() =>
      expect(document.activeElement?.id).toBe('workspace-sources-heading'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    media.restore();
  }
});
it('renders the generic missing-workspace state without sending an empty id', async () => {
  setup('/missing', [{ path: '/missing', element: <WorkspaceDetailPage /> }]);
  expect(
    await screen.findByRole('heading', { name: 'Workspace not found' }),
  ).toBeTruthy();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('uses the application browser router and session guard on a history change', async () => {
  window.history.replaceState(null, '', '/app/workspaces/w1/settings');
  await act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppRouter />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
  cleanup();
  window.history.replaceState(null, '', '/');
  await act(() => window.dispatchEvent(new PopStateEvent('popstate')));
});

it('falls back to the reader wrapper when a narrow source route has no workspace parameter', async () => {
  const media = desktopMedia(true);
  try {
    setup('/missing', [{ path: '/missing', element: <SourceRoutePage /> }]);
    expect(screen.getByRole('region', { name: 'Source reader' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    media.restore();
  }
});

it('retains source controls and version selectors while resizing an open reader', async () => {
  const media = desktopMedia();
  try {
    const query = '?version=v2&processingVersion=p3&unit=unit-7&page=4';
    const router = setup(`/app/workspaces/w1/sources/s1${query}`);
    const input = await screen.findByLabelText('Source action');
    fireEvent.change(input, { target: { value: 'Keep source state' } });
    act(() => media.resize(true));
    expect(screen.getByRole('dialog', { name: 'Source details' })).toBeTruthy();
    expect(screen.getByLabelText('Source action')).toBe(input);
    expect(input).toHaveProperty('value', 'Keep source state');
    act(() => media.resize(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Source action')).toBe(input);
    expect(router.state.location.search).toBe(query);
  } finally {
    media.restore();
  }
});
