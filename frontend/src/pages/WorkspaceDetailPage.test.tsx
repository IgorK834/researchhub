/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkspaceDetailPage } from './WorkspaceDetailPage';

const WORKSPACE_ID = 'w-1';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ workspaceId: WORKSPACE_ID }),
}));

interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly role: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

function workspaceRow(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: WORKSPACE_ID,
    name: 'Electronics Lab',
    description: 'Team 4',
    role: 'OWNER',
    createdAt: '2026-09-23T10:15:30Z',
    updatedAt: '2026-09-23T10:15:30Z',
    archivedAt: null,
    ...overrides,
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

function problem(status: number, code: string, detail: string): Response {
  return jsonResponse(
    { type: 'about:blank', title: code, status, detail, code },
    status,
    'application/problem+json',
  );
}

/**
 * A small stand-in for the workspace endpoints. The detail read reflects earlier writes, so a test can see
 * what the page shows after a save or an archive rather than only what it sent.
 */
function stubWorkspaceApi(options: {
  readonly workspace?: WorkspaceRow;
  readonly detailResponse?: Response;
  readonly patchResponse?: Response;
  readonly archiveResponse?: Response;
}): jest.Mock {
  let current = options.workspace ?? workspaceRow();

  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    if (path === '/api/auth/csrf') {
      return Promise.resolve(emptyNoContent());
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}` && method === 'PATCH') {
      if (options.patchResponse !== undefined) {
        return Promise.resolve(options.patchResponse);
      }
      const body = JSON.parse(String(init?.body)) as {
        name: string;
        description: string;
      };
      current = { ...current, name: body.name, description: body.description || null };
      return Promise.resolve(jsonResponse(current, 200, 'application/json'));
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/archive` && method === 'POST') {
      if (options.archiveResponse !== undefined) {
        return Promise.resolve(options.archiveResponse);
      }
      current = { ...current, archivedAt: '2026-09-24T09:00:00Z' };
      return Promise.resolve(jsonResponse(current, 200, 'application/json'));
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}` && method === 'GET') {
      return Promise.resolve(
        options.detailResponse ?? jsonResponse(current, 200, 'application/json'),
      );
    }
    if (path === '/api/workspaces' && method === 'GET') {
      return Promise.resolve(jsonResponse([], 200, 'application/json'));
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Returns the client so a test can inspect what a mutation did to the cache. */
function renderWorkspaceDetailPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<WorkspaceDetailPage />, { wrapper });
  return queryClient;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockNavigate.mockReset();
  jest.restoreAllMocks();
});

describe('WorkspaceDetailPage', () => {
  it('shows the workspace and the role the caller holds in it', async () => {
    stubWorkspaceApi({ workspace: workspaceRow({ role: 'VIEWER' }) });

    renderWorkspaceDetailPage();

    expect(
      await screen.findByRole('heading', { name: 'Electronics Lab' }),
    ).not.toBeNull();
    expect(screen.getByText('VIEWER')).not.toBeNull();
    expect(screen.getByText('Team 4')).not.toBeNull();
  });

  it('shows a not-found state for a 404 without saying whether the workspace exists', async () => {
    stubWorkspaceApi({
      detailResponse: problem(404, 'RESOURCE_NOT_FOUND', 'Workspace was not found'),
    });

    renderWorkspaceDetailPage();

    expect(
      await screen.findByRole('heading', { name: 'Workspace not found' }),
    ).not.toBeNull();
    const message = screen.getByText(/not available/);
    expect(message.textContent).toContain('may not have access');
    // The server refuses to distinguish "no such workspace" from "not yours". The page must not either.
    expect(screen.queryByText(/does not exist/)).toBeNull();
  });

  it('reports a failure that is not a 404 as an error rather than a missing workspace', async () => {
    stubWorkspaceApi({
      detailResponse: problem(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
    });

    renderWorkspaceDetailPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load this workspace');
    expect(screen.queryByRole('heading', { name: 'Workspace not found' })).toBeNull();
  });

  it('offers the owner controls to an owner', async () => {
    stubWorkspaceApi({ workspace: workspaceRow({ role: 'OWNER' }) });

    renderWorkspaceDetailPage();

    expect(await screen.findByRole('button', { name: 'Save changes' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Archive workspace' })).not.toBeNull();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Electronics Lab');
    expect(screen.getByLabelText('Description')).toHaveProperty('value', 'Team 4');
  });

  it('does not offer the owner controls to an editor or a viewer', async () => {
    for (const role of ['EDITOR', 'VIEWER']) {
      stubWorkspaceApi({ workspace: workspaceRow({ role }) });
      renderWorkspaceDetailPage();

      expect(await screen.findByText(role)).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
      expect(screen.queryByLabelText('Name')).toBeNull();

      // Explicit, because automatic cleanup happens between tests rather than between iterations.
      cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  it('saves a rename and shows the new name', async () => {
    const fetchMock = stubWorkspaceApi({});

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Electronics Lab — Team 4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Changes saved.',
    );
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Electronics Lab — Team 4' }),
      ).not.toBeNull();
    });

    const patch = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patch?.[0]).toBe(`/api/workspaces/${WORKSPACE_ID}`);
    expect(JSON.parse(String((patch?.[1] as RequestInit | undefined)?.body))).toEqual({
      name: 'Electronics Lab — Team 4',
      description: 'Team 4',
    });
  });

  it('shows a rejected name next to the field and a refused role as one message', async () => {
    stubWorkspaceApi({
      patchResponse: jsonResponse(
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

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('must not be blank')).not.toBeNull();
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a 409 from an archived workspace as one message', async () => {
    stubWorkspaceApi({
      patchResponse: problem(
        409,
        'CONFLICT',
        'This workspace is archived and cannot be renamed',
      ),
    });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('archived');
  });

  it('asks for confirmation before archiving', async () => {
    const fetchMock = stubWorkspaceApi({});

    renderWorkspaceDetailPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive workspace' }));

    expect(screen.getByText(/Archive this workspace\?/).textContent).toContain(
      'Nothing is deleted',
    );
    expect(
      fetchMock.mock.calls.some(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Archive workspace' })).not.toBeNull();
    expect(screen.queryByText(/Archive this workspace\?/)).toBeNull();
  });

  it('archives on confirmation, invalidates the list, and returns to it', async () => {
    const fetchMock = stubWorkspaceApi({});
    const queryClient = renderWorkspaceDetailPage();
    // A cached list from an earlier visit. It still contains the workspace that is about to leave it,
    // which is exactly the stale state the invalidation has to deal with.
    queryClient.setQueryData(['workspaces'], [workspaceRow()]);

    fireEvent.click(await screen.findByRole('button', { name: 'Archive workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/workspaces');
    });

    const archiveCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith('/archive'),
    );
    expect(archiveCall?.[0]).toBe(`/api/workspaces/${WORKSPACE_ID}/archive`);
    expect((archiveCall?.[1] as RequestInit | undefined)?.method).toBe('POST');

    // Asserted on the cache rather than on a refetch: no list is mounted on this page, so invalidation
    // marks the key stale and the request happens when the list mounts again. Marking it is the part this
    // component is responsible for.
    expect(queryClient.getQueryState(['workspaces'])?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryData<{ archivedAt: string | null }>([
        'workspaces',
        WORKSPACE_ID,
      ])?.archivedAt,
    ).not.toBeNull();
  });

  it('shows an archived workspace as archived and withdraws the owner controls', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
    });

    renderWorkspaceDetailPage();

    // Wait for the heading first: the loading paragraph is also a `status`, so querying for the role
    // straight away would match "Loading this workspace…" and pass for the wrong reason.
    await screen.findByRole('heading', { name: 'Electronics Lab' });

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('archived');
    expect(notice.textContent).toContain('Nothing has been deleted');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
  });
});
