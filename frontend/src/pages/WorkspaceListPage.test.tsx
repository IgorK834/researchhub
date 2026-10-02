/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { WorkspaceListPage } from './WorkspaceListPage';
import {
  CreateWorkspaceDialogProvider,
  useCreateWorkspaceDialog,
} from '../features/workspaces/components/CreateWorkspaceDialog';
import { Button } from '../shared/components/Button';

function Frame({ displayName }: { readonly displayName: string }): ReactElement {
  const { openCreateWorkspace, defaultTriggerRef } = useCreateWorkspaceDialog();
  return (
    <>
      <Button
        ref={defaultTriggerRef}
        onClick={(event) => openCreateWorkspace(event.currentTarget)}
      >
        New workspace
      </Button>
      <Outlet context={{ user: { displayName } }} />
    </>
  );
}

interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly role: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

/**
 * `archivedAt` is always null here, and that is the contract rather than a simplification: the list
 * endpoint filters archived workspaces out server-side, so one can never appear in this response.
 */
function workspace(name: string, role: string, description: string | null): WorkspaceRow {
  return {
    id: `w-${name}`,
    name,
    description,
    role,
    createdAt: '2026-09-23T10:15:30Z',
    updatedAt: '2026-09-23T10:15:30Z',
    archivedAt: null,
  };
}

/** Minimal `Response` double: jsdom does not implement the Fetch API response classes. */
function jsonResponse(body: unknown, status: number, contentType: string): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: () => Promise.resolve(payload),
  } as unknown as Response;
}

function emptyNoContent(): Response {
  return {
    ok: true,
    status: 204,
    statusText: '',
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

/**
 * A tiny stand-in for the workspace endpoints: the list reflects what has been created, so the refetch
 * after a successful create returns something different from the first load. That is the behaviour under
 * test — a stub returning one fixed body could not tell a working invalidation from a missing one.
 */
function stubWorkspaceApi(options: {
  readonly initial?: readonly WorkspaceRow[];
  readonly listResponse?: Response;
  readonly createResponse?: Response;
}): jest.Mock {
  const rows: WorkspaceRow[] = [...(options.initial ?? [])];

  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    if (path === '/api/auth/csrf') {
      return Promise.resolve(emptyNoContent());
    }
    if (path === '/api/workspaces' && method === 'POST') {
      if (options.createResponse !== undefined) {
        return Promise.resolve(options.createResponse);
      }
      const body = JSON.parse(String(init?.body)) as {
        name: string;
        description: string;
      };
      const created = workspace(body.name, 'OWNER', body.description || null);
      rows.push(created);
      return Promise.resolve(jsonResponse(created, 201, 'application/json'));
    }
    if (path === '/api/workspaces' && method === 'GET') {
      return Promise.resolve(
        options.listResponse ?? jsonResponse(rows, 200, 'application/json'),
      );
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderWorkspaceListPage(displayName = 'Ada'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route
            path="/app"
            element={
              <CreateWorkspaceDialogProvider>
                <Frame displayName={displayName} />
              </CreateWorkspaceDialogProvider>
            }
          >
            <Route index element={children} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<WorkspaceListPage />, { wrapper });
}

function fillAndSubmit(name: string, description: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: description },
  });
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Create workspace' }),
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('WorkspaceListPage', () => {
  it('greets the resolved user and displays card metadata with one collection request', async () => {
    const fetchMock = stubWorkspaceApi({
      initial: [
        workspace('Lab', 'EDITOR', 'Research'),
        workspace('Future workspace', 'REVIEWER', null),
      ],
    });
    renderWorkspaceListPage();
    expect(screen.getByRole('heading', { name: 'Welcome back, Ada.' })).toBeDefined();
    const list = await screen.findByRole('list', { name: 'Your workspaces' });
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Editor')).toBeDefined();
    expect(within(rows[1]!).getByText('REVIEWER')).toBeDefined();
    expect(rows[0]?.querySelector('time')?.dateTime).toBe('2026-09-23T10:15:30Z');
    expect(rows[0]?.querySelector('time')?.textContent).not.toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/workspaces');
  });

  it('shows a neutral greeting for a blank display name and teaches three first-run steps', async () => {
    stubWorkspaceApi({ initial: [] });
    renderWorkspaceListPage(' ');
    expect(
      screen.getByRole('heading', { name: 'Welcome to ResearchHub.' }),
    ).toBeDefined();
    await screen.findByRole('heading', { name: 'Start your first research workspace.' });
    const onboarding = screen.getByRole('list', { name: 'Getting started' });
    expect(within(onboarding).getAllByRole('listitem')).toHaveLength(3);
    for (const title of ['Add sources', 'Write together', 'Check the evidence'])
      expect(within(onboarding).getByRole('heading', { name: title })).toBeDefined();
    expect(screen.queryByRole('link', { name: /Learn how/ })).toBeNull();
  });

  it('announces loading while keeping decorative skeletons out of the accessible content', async () => {
    let resolve!: (value: Response) => void;
    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ) as unknown as typeof fetch;
    renderWorkspaceListPage();
    expect(screen.getByRole('status').textContent).toBe('Loading your workspaces…');
    expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Your workspaces' })).toBeNull();
    await act(async () => resolve(jsonResponse([], 200, 'application/json')));
    await screen.findByRole('heading', { name: 'Start your first research workspace.' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('updates the preview live and restores focus to the opener on Cancel, discarding the draft', async () => {
    const fetchMock = stubWorkspaceApi({ initial: [] });
    renderWorkspaceListPage();
    await screen.findByRole('heading', { name: 'Start your first research workspace.' });
    const opener = screen.getByRole('button', { name: 'New workspace' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' });
    const preview = within(dialog).getByRole('complementary', {
      name: 'Workspace preview',
    });
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'));
    expect(
      within(preview).getByRole('heading', { name: 'Workspace name' }),
    ).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: '  Photonics Seminar  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Reading group' },
    });
    expect(
      within(preview).getByRole('heading', { name: 'Photonics Seminar' }),
    ).toBeDefined();
    expect(within(preview).getByText('Reading group')).toBeDefined();
    expect(within(preview).getByText('Owner')).toBeDefined();
    expect(within(preview).queryByRole('link')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Description')).toHaveProperty('value', '');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
    expect(
      fetchMock.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'POST'),
    ).toBe(false);
  });

  it('returns focus to the stable New workspace action if creation removes the empty-state opener', async () => {
    stubWorkspaceApi({ initial: [] });
    renderWorkspaceListPage();
    const empty = await screen.findByRole('region', {
      name: 'Start your first research workspace.',
    });
    fireEvent.click(within(empty).getByRole('button', { name: 'Create workspace' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'First workspace' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create workspace' }));
    await screen.findByRole('link', { name: 'First workspace' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'New workspace' }),
    );
  });

  it('associates description validation with the textarea and prevents duplicate pending submissions', async () => {
    let resolve!: (value: Response) => void;
    const initial = jsonResponse([], 200, 'application/json');
    const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
      if (String(url) === '/api/auth/csrf') return Promise.resolve(emptyNoContent());
      if (init?.method !== 'POST') return Promise.resolve(initial);
      return new Promise<Response>((done) => {
        resolve = done;
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWorkspaceListPage();
    await screen.findByRole('heading', { name: 'Start your first research workspace.' });
    fillAndSubmit('Lab', 'Too long');
    const button = await screen.findByRole('button', { name: 'Creating…' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST'),
      ).toHaveLength(1),
    );
    fireEvent.submit(button.closest('form')!);
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST'),
    ).toHaveLength(1);
    await act(async () =>
      resolve(
        jsonResponse(
          {
            status: 400,
            code: 'VALIDATION_FAILED',
            detail: 'Validation failed',
            errors: [{ field: 'description', message: 'Description is too long.' }],
          },
          400,
          'application/problem+json',
        ),
      ),
    );
    const message = await screen.findByText('Description is too long.');
    const description = screen.getByLabelText('Description');
    expect(description.getAttribute('aria-invalid')).toBe('true');
    expect(description.getAttribute('aria-describedby')).toBe(
      `workspace-description-hint ${message.id}`,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('lists the workspaces the signed-in user belongs to, with their role', async () => {
    stubWorkspaceApi({
      initial: [
        workspace('Electronics Lab', 'OWNER', 'Team 4'),
        workspace('Thesis', 'VIEWER', null),
      ],
    });

    renderWorkspaceListPage();

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Electronics Lab');
    expect(items[0]?.textContent).toContain('Owner');
    expect(items[0]?.textContent).toContain('Team 4');
    expect(items[1]?.textContent).toContain('Thesis');
    expect(items[1]?.textContent).toContain('Viewer');
  });

  it('links each workspace to its own route', async () => {
    stubWorkspaceApi({ initial: [workspace('Electronics Lab', 'OWNER', null)] });

    renderWorkspaceListPage();

    const link = await screen.findByRole('link', { name: 'Electronics Lab' });
    expect(link.getAttribute('href')).toBe('/app/workspaces/w-Electronics Lab');
  });

  it('treats belonging to no workspace as an empty list rather than an error', async () => {
    stubWorkspaceApi({ initial: [] });

    renderWorkspaceListPage();

    expect(
      await screen.findByText('Start your first research workspace.'),
    ).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('creates a workspace and shows it in the refreshed list', async () => {
    const fetchMock = stubWorkspaceApi({ initial: [] });

    renderWorkspaceListPage();
    await screen.findByText('Start your first research workspace.');

    fillAndSubmit('Electronics Lab', 'Team 4');

    await waitFor(() => {
      expect(screen.getByRole('listitem').textContent).toContain('Electronics Lab');
    });

    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(post?.[0]).toBe('/api/workspaces');
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toEqual({
      name: 'Electronics Lab',
      description: 'Team 4',
    });

    // The new row came from the query being refetched after the mutation invalidated ['workspaces'] —
    // not from the page reloading, and not from the response being spliced into local state. Two GETs:
    // the first render, then the refetch.
    const listReads = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]) === '/api/workspaces' &&
        ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    expect(listReads.length).toBeGreaterThanOrEqual(2);
  });

  it('never sends a creator in the request body', async () => {
    const fetchMock = stubWorkspaceApi({ initial: [] });

    renderWorkspaceListPage();
    fillAndSubmit('Electronics Lab', '');

    await waitFor(() => {
      expect(screen.getByRole('listitem')).not.toBeNull();
    });

    const post = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    const body = String((post?.[1] as RequestInit | undefined)?.body);
    // The owner is the authenticated caller, decided by the server. A client that sent one here would
    // be claiming an authority it does not have.
    expect(body).not.toContain('createdBy');
    expect(body).not.toContain('role');
  });

  it('empties the form after a successful create', async () => {
    stubWorkspaceApi({ initial: [] });

    renderWorkspaceListPage();
    fillAndSubmit('Electronics Lab', 'Team 4');
    await screen.findByRole('link', { name: 'Electronics Lab' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Description')).toHaveProperty('value', '');
  });

  it('shows a rejected name next to the field it belongs to', async () => {
    stubWorkspaceApi({
      initial: [],
      createResponse: jsonResponse(
        {
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          detail: 'Request validation failed',
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'name', message: 'must not be blank' }],
        },
        400,
        'application/problem+json',
      ),
    });

    renderWorkspaceListPage();
    fillAndSubmit('   ', '');

    expect(await screen.findByText('must not be blank')).not.toBeNull();

    const nameInput = screen.getByLabelText('Name');
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(nameInput.getAttribute('aria-describedby')).toBe('workspace-name-error');
    // A field-level problem is reported on the field, not duplicated in a banner.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failure that belongs to no single field in an alert', async () => {
    stubWorkspaceApi({
      initial: [],
      createResponse: jsonResponse(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'Forbidden',
          code: 'FORBIDDEN',
        },
        403,
        'application/problem+json',
      ),
    });

    renderWorkspaceListPage();
    fillAndSubmit('Electronics Lab', '');

    expect(await screen.findByRole('alert')).not.toBeNull();
  });

  it('reports a list that could not be loaded without pretending it is empty', async () => {
    stubWorkspaceApi({
      listResponse: jsonResponse(
        {
          type: 'about:blank',
          title: 'Internal error',
          status: 500,
          detail: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
        },
        500,
        'application/problem+json',
      ),
    });

    renderWorkspaceListPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load your workspaces');
    expect(screen.queryByText('Start your first research workspace.')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
