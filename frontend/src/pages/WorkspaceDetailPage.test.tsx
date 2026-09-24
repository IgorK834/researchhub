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

interface MemberRow {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
}

/** A document summary. No `content` field, matching what the list endpoint returns. */
interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly contentFormat: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

const REPORT_DOCUMENT: DocumentRow = {
  id: 'd-1',
  title: 'Final report',
  contentFormat: 'PROSEMIRROR_JSON',
  revision: 3,
  createdAt: '2026-09-23T10:15:30Z',
  updatedAt: '2026-09-23T10:15:30Z',
  archivedAt: null,
};

const OWNER_MEMBER: MemberRow = {
  userId: 'u-ada',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  role: 'OWNER',
};

const EDITOR_MEMBER: MemberRow = {
  userId: 'u-kasia',
  email: 'kasia@example.com',
  displayName: 'Kasia Nowak',
  role: 'EDITOR',
};

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
  readonly members?: readonly MemberRow[];
  readonly membersResponse?: Response;
  readonly addMemberResponse?: Response;
  readonly changeRoleResponse?: Response;
  readonly documents?: readonly DocumentRow[];
  readonly documentsResponse?: Response;
  /** When true, the list request never resolves, so the loading state stays on screen. */
  readonly documentsPending?: boolean;
}): jest.Mock {
  let current = options.workspace ?? workspaceRow();
  const members: MemberRow[] = [...(options.members ?? [OWNER_MEMBER])];
  const documents: DocumentRow[] = [...(options.documents ?? [])];
  const membersPath = `/api/workspaces/${WORKSPACE_ID}/members`;
  const documentsPath = `/api/workspaces/${WORKSPACE_ID}/documents`;

  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    if (path === '/api/auth/csrf') {
      return Promise.resolve(emptyNoContent());
    }
    if (path === documentsPath && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { title: string };
      const created: DocumentRow = {
        id: `d-${body.title}`,
        title: body.title,
        contentFormat: 'PROSEMIRROR_JSON',
        revision: 1,
        createdAt: '2026-09-23T10:15:30Z',
        updatedAt: '2026-09-23T10:15:30Z',
        archivedAt: null,
      };
      documents.push(created);
      return Promise.resolve(jsonResponse(created, 201, 'application/json'));
    }
    if (path === documentsPath && method === 'GET') {
      if (options.documentsPending === true) {
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(
        options.documentsResponse ?? jsonResponse(documents, 200, 'application/json'),
      );
    }
    if (path === membersPath && method === 'POST') {
      if (options.addMemberResponse !== undefined) {
        return Promise.resolve(options.addMemberResponse);
      }
      const body = JSON.parse(String(init?.body)) as { email: string; role: string };
      const added: MemberRow = {
        userId: `u-${body.email}`,
        email: body.email,
        displayName: 'Kasia Nowak',
        role: body.role,
      };
      members.push(added);
      return Promise.resolve(jsonResponse(added, 201, 'application/json'));
    }
    if (path.startsWith(`${membersPath}/`) && method === 'PATCH') {
      if (options.changeRoleResponse !== undefined) {
        return Promise.resolve(options.changeRoleResponse);
      }
      const userId = path.slice(`${membersPath}/`.length);
      const body = JSON.parse(String(init?.body)) as { role: string };
      const index = members.findIndex((member) => member.userId === userId);
      const existing = members[index];
      if (existing === undefined) {
        return Promise.resolve(
          problem(404, 'RESOURCE_NOT_FOUND', 'Workspace member was not found'),
        );
      }
      const updated = { ...existing, role: body.role };
      members[index] = updated;
      return Promise.resolve(jsonResponse(updated, 200, 'application/json'));
    }
    if (path.startsWith(`${membersPath}/`) && method === 'DELETE') {
      const userId = path.slice(`${membersPath}/`.length);
      const index = members.findIndex((member) => member.userId === userId);
      if (index >= 0) {
        members.splice(index, 1);
      }
      return Promise.resolve(emptyNoContent());
    }
    if (path === membersPath && method === 'GET') {
      return Promise.resolve(
        options.membersResponse ?? jsonResponse(members, 200, 'application/json'),
      );
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

    // By text, not by role: the member section contributes its own `status` while it loads.
    expect(await screen.findByText('Changes saved.')).not.toBeNull();
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

  // --- documents ---

  it('shows a loading state while the document list is still in flight', async () => {
    stubWorkspaceApi({ documentsPending: true });

    renderWorkspaceDetailPage();

    expect(await screen.findByText('Loading documents…')).not.toBeNull();
    expect(screen.queryByText('No documents yet.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Final report' })).toBeNull();
  });

  it('links each document to its own route', async () => {
    stubWorkspaceApi({ documents: [REPORT_DOCUMENT] });

    renderWorkspaceDetailPage();

    const link = await screen.findByRole('link', { name: 'Final report' });
    expect(link.getAttribute('href')).toBe(
      `/app/workspaces/${WORKSPACE_ID}/documents/d-1`,
    );
  });

  it('treats a workspace with no documents as an empty list rather than an error', async () => {
    stubWorkspaceApi({ documents: [] });

    renderWorkspaceDetailPage();

    expect(await screen.findByText('No documents yet.')).not.toBeNull();
    expect(screen.queryByText(/Could not load the documents/)).toBeNull();
  });

  it('reports documents that could not be loaded without pretending there are none', async () => {
    stubWorkspaceApi({
      documentsResponse: problem(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
    });

    renderWorkspaceDetailPage();

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(
        alerts.some((alert) =>
          alert.textContent?.includes('Could not load the documents'),
        ),
      ).toBe(true);
    });
    expect(screen.queryByText('No documents yet.')).toBeNull();
  });

  it('creates a document and shows it in the refreshed list', async () => {
    const fetchMock = stubWorkspaceApi({ documents: [] });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Document title'), {
      target: { value: 'Final report' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));

    // Rendered from the refetched list, not from the mutation response being spliced into local state.
    expect(await screen.findByRole('link', { name: 'Final report' })).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText('Document title')).toHaveProperty('value', '');
    });

    const listReads = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]) === `/api/workspaces/${WORKSPACE_ID}/documents` &&
        ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    );
    expect(listReads.length).toBeGreaterThanOrEqual(2);
  });

  it('lets an editor create a document but not manage the workspace', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'EDITOR' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage();

    expect(await screen.findByRole('button', { name: 'Create document' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('shows a viewer the documents without a way to start one', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage();

    expect(await screen.findByRole('link', { name: 'Final report' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create document' })).toBeNull();
    expect(screen.queryByLabelText('Document title')).toBeNull();
  });

  it('offers no way to create a document in an archived workspace', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage();

    expect(await screen.findByRole('link', { name: 'Final report' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create document' })).toBeNull();
  });

  // --- members ---

  it('shows the member list to a viewer, without any control to change it', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      members: [OWNER_MEMBER, EDITOR_MEMBER],
    });

    renderWorkspaceDetailPage();

    expect(await screen.findByText('Ada Lovelace')).not.toBeNull();
    expect(screen.getByText('kasia@example.com')).not.toBeNull();
    // Roles are visible as text rather than as editable selects.
    expect(screen.queryByLabelText('Role for Ada Lovelace')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Kasia Nowak' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('offers an owner a role control and a remove control for each member', async () => {
    stubWorkspaceApi({ members: [OWNER_MEMBER, EDITOR_MEMBER] });

    renderWorkspaceDetailPage();

    expect(await screen.findByLabelText('Role for Kasia Nowak')).toHaveProperty(
      'value',
      'EDITOR',
    );
    expect(screen.getByLabelText('Role for Ada Lovelace')).toHaveProperty(
      'value',
      'OWNER',
    );
    expect(screen.getByRole('button', { name: 'Remove Kasia Nowak' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a member' })).not.toBeNull();
  });

  it('adds a member and shows them in the refreshed list', async () => {
    const fetchMock = stubWorkspaceApi({ members: [OWNER_MEMBER] });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'kasia@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    // Rendered from the refetched roster, not from local state the form kept.
    expect(await screen.findByText('kasia@example.com')).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveProperty('value', '');
    });

    const post = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === 'POST' &&
        String(call[0]).endsWith('/members'),
    );
    expect(JSON.parse(String((post?.[1] as RequestInit | undefined)?.body))).toEqual({
      email: 'kasia@example.com',
      role: 'EDITOR',
    });
  });

  it('shows an address with no account as one message and offers no invitation', async () => {
    stubWorkspaceApi({
      addMemberResponse: problem(
        404,
        'RESOURCE_NOT_FOUND',
        'No registered user has that email',
      ),
    });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('No registered user has that email');
    expect(screen.queryByText(/invite/i)).toBeNull();
  });

  it('shows an already-a-member response as a conflict message', async () => {
    stubWorkspaceApi({
      addMemberResponse: problem(
        409,
        'CONFLICT',
        'That user is already a member of this workspace',
      ),
    });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'kasia@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already a member');
  });

  it('changes a role and shows the refused last-owner demotion as a message', async () => {
    stubWorkspaceApi({
      members: [OWNER_MEMBER, EDITOR_MEMBER],
      changeRoleResponse: problem(
        409,
        'CONFLICT',
        'A workspace must always have at least one owner. Promote another member first.',
      ),
    });

    renderWorkspaceDetailPage();
    fireEvent.change(await screen.findByLabelText('Role for Ada Lovelace'), {
      target: { value: 'EDITOR' },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('at least one owner');
  });

  it('removes a member from the displayed list', async () => {
    stubWorkspaceApi({ members: [OWNER_MEMBER, EDITOR_MEMBER] });

    renderWorkspaceDetailPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Kasia Nowak' }));

    await waitFor(() => {
      expect(screen.queryByText('kasia@example.com')).toBeNull();
    });
    expect(screen.getByText('ada@example.com')).not.toBeNull();
  });

  it('lists members on an archived workspace but offers no way to change them', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
      members: [OWNER_MEMBER, EDITOR_MEMBER],
    });

    renderWorkspaceDetailPage();

    expect(await screen.findByText('kasia@example.com')).not.toBeNull();
    expect(screen.queryByLabelText('Role for Kasia Nowak')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Kasia Nowak' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('shows an archived workspace as archived and withdraws the owner controls', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
    });

    renderWorkspaceDetailPage();

    // Matched by its text rather than by role: several things on this page announce themselves as a
    // `status`, including the page and the member list while they load.
    const notice = await screen.findByText(/This workspace is archived/);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Nothing has been deleted');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
  });
});
