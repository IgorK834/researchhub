/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkspaceListPage } from './WorkspaceListPage';

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

function renderWorkspaceListPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<WorkspaceListPage />, { wrapper });
}

function fillAndSubmit(name: string, description: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: description },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('WorkspaceListPage', () => {
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
    expect(items[0]?.textContent).toContain('OWNER');
    expect(items[0]?.textContent).toContain('Team 4');
    expect(items[1]?.textContent).toContain('Thesis');
    expect(items[1]?.textContent).toContain('VIEWER');
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
      await screen.findByText(
        'You do not belong to any workspace yet. Create one to get started.',
      ),
    ).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('creates a workspace and shows it in the refreshed list', async () => {
    const fetchMock = stubWorkspaceApi({ initial: [] });

    renderWorkspaceListPage();
    await screen.findByText(
      'You do not belong to any workspace yet. Create one to get started.',
    );

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

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
    });
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
    expect(
      screen.queryByText(
        'You do not belong to any workspace yet. Create one to get started.',
      ),
    ).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
