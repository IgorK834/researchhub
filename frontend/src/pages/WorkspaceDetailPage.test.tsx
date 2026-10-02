/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

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

interface SourceRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly originalFilename: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sourceType: 'PDF' | 'DOCX' | 'XLSX' | 'CSV' | 'TXT';
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  readonly failureSummary: string | null;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  readonly sources?: readonly SourceRow[];
  readonly sourceState?: SourceRow[];
  readonly sourcesResponse?: Response;
  readonly sourceUploadResponse?: Response;
  readonly sourceUploadPending?: boolean;
  /** When true, the list request never resolves, so the loading state stays on screen. */
  readonly documentsPending?: boolean;
}): jest.Mock {
  let current = options.workspace ?? workspaceRow();
  const members: MemberRow[] = [...(options.members ?? [OWNER_MEMBER])];
  const documents: DocumentRow[] = [...(options.documents ?? [])];
  const sources: SourceRow[] = options.sourceState ?? [...(options.sources ?? [])];
  const membersPath = `/api/workspaces/${WORKSPACE_ID}/members`;
  const documentsPath = `/api/workspaces/${WORKSPACE_ID}/documents`;
  const sourcesPath = `/api/workspaces/${WORKSPACE_ID}/sources`;

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
    if (path === sourcesPath && method === 'POST') {
      if (options.sourceUploadPending === true) {
        return new Promise<Response>(() => undefined);
      }
      if (options.sourceUploadResponse !== undefined) {
        return Promise.resolve(options.sourceUploadResponse);
      }
      const body = init?.body as FormData;
      const file = body.get('file') as File;
      const extension = file.name.split('.').pop()?.toUpperCase() ?? 'TXT';
      const created: SourceRow = {
        id: `s-${String(sources.length + 1)}`,
        workspaceId: WORKSPACE_ID,
        originalFilename: file.name,
        displayName: file.name,
        mediaType: file.type,
        sourceType: extension as SourceRow['sourceType'],
        sizeBytes: file.size,
        contentSha256: '0'.repeat(64),
        status: 'UPLOADED',
        failureSummary: null,
        uploadedBy: 'u-ada',
        createdAt: '2026-09-23T10:15:30Z',
        updatedAt: '2026-09-23T10:15:30Z',
      };
      sources.push(created);
      return Promise.resolve(jsonResponse(created, 201, 'application/json'));
    }
    if (path === sourcesPath && method === 'GET') {
      return Promise.resolve(
        options.sourcesResponse ?? jsonResponse(sources, 200, 'application/json'),
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
function renderWorkspaceDetailPage(
  entry = '/',
  section: import('../app/workspaceRoutes').WorkspaceSection = 'overview',
): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<WorkspaceDetailPage section={section} />, { wrapper });
  return queryClient;
}

const originalFetch = globalThis.fetch;
const originalXhr = globalThis.XMLHttpRequest;

/** Makes the progress-capable upload transport talk to the same in-memory API as the other requests. */
function installUploadTransport(fetchMock: jest.Mock): void {
  class UploadRequest {
    readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    withCredentials = false;
    status = 0;
    statusText = '';
    responseText = '';
    private path = '';
    private readonly headers: Record<string, string> = {};

    open(method: string, path: string): void {
      expect(method).toBe('POST');
      this.path = path;
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }

    getResponseHeader(name: string): string | null {
      return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }

    send(body: FormData): void {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 6,
        total: 12,
      } as ProgressEvent);
      void (
        fetchMock(this.path, {
          method: 'POST',
          body,
          headers: this.headers,
        }) as Promise<Response>
      )
        .then(async (response) => {
          this.status = response.status;
          this.responseText = await response.text();
          this.onload?.();
        })
        .catch(() => this.onerror?.());
    }
  }

  globalThis.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXhr;
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
    expect(screen.getByText('Viewer')).not.toBeNull();
    expect(screen.getByText('Team 4')).not.toBeNull();
  });

  it('opens the questions scoped to the dataset chosen with "Analyze this data"', async () => {
    stubWorkspaceApi({
      sources: [
        {
          id: 's-9',
          workspaceId: WORKSPACE_ID,
          originalFilename: 'measurements.xlsx',
          displayName: 'measurements.xlsx',
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourceType: 'XLSX',
          sizeBytes: 10,
          contentSha256: '0'.repeat(64),
          status: 'READY',
          failureSummary: null,
          uploadedBy: 'u-ada',
          createdAt: '2026-09-23T10:15:30Z',
          updatedAt: '2026-09-23T10:15:30Z',
        },
      ],
    });

    renderWorkspaceDetailPage(
      '/?analyzeSource=s-9&analyzeVersion=v2&analyzeSheet=Measurements',
      'ask',
    );

    const question = (await screen.findByLabelText('Question')) as HTMLTextAreaElement;
    expect(question.value).toContain(
      'Describe the columns, data types and data-quality issues',
    );
    expect(question.value).toContain('Focus on the "Measurements" sheet.');
    const questions = screen.getByRole('region', { name: 'Ask workspace sources' });
    expect(await within(questions).findByLabelText('measurements.xlsx')).toHaveProperty(
      'checked',
      true,
    );
    expect(document.activeElement).toBe(question);
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

    renderWorkspaceDetailPage('/', 'settings');

    expect(await screen.findByRole('button', { name: 'Save changes' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Archive workspace' })).not.toBeNull();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Electronics Lab');
    expect(screen.getByLabelText('Description')).toHaveProperty('value', 'Team 4');
  });

  it('does not offer the owner controls to an editor or a viewer', async () => {
    for (const role of ['EDITOR', 'VIEWER']) {
      stubWorkspaceApi({ workspace: workspaceRow({ role }) });
      renderWorkspaceDetailPage('/', 'settings');

      expect(
        await screen.findByText(role === 'EDITOR' ? 'Editor' : 'Viewer'),
      ).not.toBeNull();
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

    renderWorkspaceDetailPage('/', 'settings');
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

    renderWorkspaceDetailPage('/', 'settings');
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

    renderWorkspaceDetailPage('/', 'settings');
    fireEvent.change(await screen.findByLabelText('Name'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('archived');
  });

  it('asks for confirmation before archiving', async () => {
    const fetchMock = stubWorkspaceApi({});

    renderWorkspaceDetailPage('/', 'settings');
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
    const queryClient = renderWorkspaceDetailPage('/', 'settings');
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

    renderWorkspaceDetailPage('/', 'documents');

    expect(await screen.findByText('Loading documents…')).not.toBeNull();
    expect(screen.queryByText('No documents yet.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Final report' })).toBeNull();
  });

  it('links each document to its own route', async () => {
    stubWorkspaceApi({ documents: [REPORT_DOCUMENT] });

    renderWorkspaceDetailPage('/', 'documents');

    const link = await screen.findByRole('link', { name: 'Final report' });
    expect(link.getAttribute('href')).toBe(
      `/app/workspaces/${WORKSPACE_ID}/documents/d-1`,
    );
  });

  it('treats a workspace with no documents as an empty list rather than an error', async () => {
    stubWorkspaceApi({ documents: [] });

    renderWorkspaceDetailPage('/', 'documents');

    expect(await screen.findByText('No documents yet.')).not.toBeNull();
    expect(screen.queryByText(/Could not load the documents/)).toBeNull();
  });

  it('reports documents that could not be loaded without pretending there are none', async () => {
    stubWorkspaceApi({
      documentsResponse: problem(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
    });

    renderWorkspaceDetailPage('/', 'documents');

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

    renderWorkspaceDetailPage('/', 'documents');
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
    // And the new document is opened, because it was created to be written in.
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^/app/workspaces/${WORKSPACE_ID}/documents/[^/]+$`),
      ),
    );
  });

  it('lets an editor create a document but not manage the workspace', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'EDITOR' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage('/', 'documents');

    expect(await screen.findByRole('button', { name: 'Create document' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('shows a viewer the documents without a way to start one', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage('/', 'documents');

    expect(await screen.findByRole('link', { name: 'Final report' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create document' })).toBeNull();
    expect(screen.queryByLabelText('Document title')).toBeNull();
  });

  it('offers no way to create a document in an archived workspace', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
      documents: [REPORT_DOCUMENT],
    });

    renderWorkspaceDetailPage('/', 'documents');

    expect(await screen.findByRole('link', { name: 'Final report' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create document' })).toBeNull();
  });

  // --- sources ---

  it('lists source metadata, uploader, date, detail and authenticated download', async () => {
    stubWorkspaceApi({
      sources: [
        {
          id: 's-1',
          workspaceId: WORKSPACE_ID,
          originalFilename: 'measurements.csv',
          displayName: 'measurements.csv',
          mediaType: 'text/csv',
          sourceType: 'CSV',
          sizeBytes: 2048,
          contentSha256: '0'.repeat(64),
          status: 'UPLOADED',
          failureSummary: null,
          uploadedBy: 'u-ada',
          createdAt: '2026-09-23T10:15:30Z',
          updatedAt: '2026-09-23T10:15:30Z',
        },
      ],
    });

    renderWorkspaceDetailPage('/', 'sources');

    const link = await screen.findByRole('link', { name: 'measurements.csv' });
    expect(link.getAttribute('href')).toBe(`/app/workspaces/${WORKSPACE_ID}/sources/s-1`);
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      `/api/workspaces/${WORKSPACE_ID}/sources/s-1/content`,
    );
    expect(screen.getByText('Uploaded')).not.toBeNull();
    expect(link.parentElement?.textContent).toContain('CSV, 2.0 KB');
    expect(link.closest('tr')?.textContent).toContain('Ada Lovelace');
    expect(link.closest('tr')?.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-09-23T10:15:30Z',
    );
  });

  it('shows a processing failure summary with the failed source', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      sources: [
        {
          id: 's-failed',
          workspaceId: WORKSPACE_ID,
          originalFilename: 'encrypted.xlsx',
          displayName: 'encrypted.xlsx',
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourceType: 'XLSX',
          sizeBytes: 4096,
          contentSha256: '1'.repeat(64),
          status: 'FAILED',
          failureSummary: 'The workbook is encrypted.',
          uploadedBy: 'u-ada',
          createdAt: '2026-09-23T10:15:30Z',
          updatedAt: '2026-09-23T10:16:30Z',
        },
      ],
    });

    renderWorkspaceDetailPage('/', 'sources');

    expect(await screen.findByText('Failed')).not.toBeNull();
    expect(screen.getByText('Failure: The workbook is encrypted.')).not.toBeNull();
    expect(screen.queryByLabelText('Source file')).toBeNull();
  });

  it('uploads a valid source as multipart data and refreshes the list', async () => {
    const fetchMock = stubWorkspaceApi({ sources: [] });
    installUploadTransport(fetchMock);
    renderWorkspaceDetailPage('/', 'sources');
    const picker = await screen.findByLabelText('Source file');
    const file = new File(['name,value\na,1\n'], 'measurements.csv', {
      type: 'text/csv',
    });

    fireEvent.change(picker, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload source' }));

    expect(await screen.findByText('Uploaded measurements.csv.')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'measurements.csv' })).not.toBeNull();
    const upload = fetchMock.mock.calls.find(
      (call) =>
        String(call[0]) === `/api/workspaces/${WORKSPACE_ID}/sources` &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect((upload?.[1] as RequestInit).body).toBeInstanceOf(FormData);
    expect((upload?.[1] as RequestInit).headers).not.toHaveProperty('Content-Type');
  });

  it('refreshes sources uploaded in another browser session', async () => {
    const sharedSources: SourceRow[] = [];
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      sourceState: sharedSources,
    });
    renderWorkspaceDetailPage('/', 'sources');
    expect(await screen.findByText('No sources yet.')).not.toBeNull();

    sharedSources.push({
      id: 's-remote',
      workspaceId: WORKSPACE_ID,
      originalFilename: 'team.csv',
      displayName: 'team.csv',
      mediaType: 'text/csv',
      sourceType: 'CSV',
      sizeBytes: 12,
      contentSha256: '0'.repeat(64),
      status: 'UPLOADED',
      failureSummary: null,
      uploadedBy: 'u-kasia',
      createdAt: '2026-09-23T10:15:30Z',
      updatedAt: '2026-09-23T10:15:30Z',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sources' }));

    expect(await screen.findByRole('link', { name: 'team.csv' })).not.toBeNull();
    expect(screen.queryByLabelText('Source file')).toBeNull();
  });

  it('shows upload progress while the server is storing the file', async () => {
    const fetchMock = stubWorkspaceApi({ sourceUploadPending: true });
    installUploadTransport(fetchMock);
    renderWorkspaceDetailPage('/', 'sources');
    const file = new File(['a,b\n1,2'], 'team.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Source file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload source' }));

    expect(await screen.findByText('Uploading team.csv: 50%')).not.toBeNull();
    expect((screen.getByLabelText('Upload progress') as HTMLProgressElement).value).toBe(
      50,
    );
  });

  it('shows a server rejection with its actionable reason', async () => {
    const fetchMock = stubWorkspaceApi({
      sourceUploadResponse: problem(
        415,
        'UNSUPPORTED_FILE_TYPE',
        'The file contents do not match its .csv extension',
      ),
    });
    installUploadTransport(fetchMock);
    renderWorkspaceDetailPage('/', 'sources');
    const file = new File(['MZ'], 'team.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Source file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload source' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The file contents do not match its .csv extension',
    );
    expect(screen.queryByRole('link', { name: 'team.csv' })).toBeNull();
  });

  it('refuses an unsupported source before making an upload request', async () => {
    const fetchMock = stubWorkspaceApi({ sources: [] });
    renderWorkspaceDetailPage('/', 'sources');
    const file = new File(['MZ'], 'program.exe', {
      type: 'application/octet-stream',
    });

    fireEvent.change(await screen.findByLabelText('Source file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload source' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Files of type .exe are not supported',
    );
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).endsWith('/sources') &&
          (call[1] as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('does not show the upload form to a viewer or in an archived workspace', async () => {
    for (const workspace of [
      workspaceRow({ role: 'VIEWER' }),
      workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
    ]) {
      stubWorkspaceApi({ workspace });
      renderWorkspaceDetailPage('/', 'sources');
      expect(await screen.findByRole('heading', { name: 'Sources' })).not.toBeNull();
      expect(screen.queryByLabelText('Source file')).toBeNull();
      cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  // --- members ---

  it('shows the member list to a viewer, without any control to change it', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ role: 'VIEWER' }),
      members: [OWNER_MEMBER, EDITOR_MEMBER],
    });

    renderWorkspaceDetailPage('/', 'members');

    expect(await screen.findByText('Ada Lovelace')).not.toBeNull();
    expect(screen.getByText('kasia@example.com')).not.toBeNull();
    // Roles are visible as text rather than as editable selects.
    expect(screen.queryByLabelText('Role for Ada Lovelace')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Kasia Nowak' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('offers an owner a role control and a remove control for each member', async () => {
    stubWorkspaceApi({ members: [OWNER_MEMBER, EDITOR_MEMBER] });

    renderWorkspaceDetailPage('/', 'members');

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

    renderWorkspaceDetailPage('/', 'members');
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

    renderWorkspaceDetailPage('/', 'members');
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

    renderWorkspaceDetailPage('/', 'members');
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

    renderWorkspaceDetailPage('/', 'members');
    fireEvent.change(await screen.findByLabelText('Role for Ada Lovelace'), {
      target: { value: 'EDITOR' },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('at least one owner');
  });

  it('removes a member from the displayed list', async () => {
    stubWorkspaceApi({ members: [OWNER_MEMBER, EDITOR_MEMBER] });

    renderWorkspaceDetailPage('/', 'members');
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

    renderWorkspaceDetailPage('/', 'members');

    expect(await screen.findByText('kasia@example.com')).not.toBeNull();
    expect(screen.queryByLabelText('Role for Kasia Nowak')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Kasia Nowak' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add a member' })).toBeNull();
  });

  it('shows an archived workspace as archived and withdraws the owner controls', async () => {
    stubWorkspaceApi({
      workspace: workspaceRow({ archivedAt: '2026-09-24T09:00:00Z' }),
    });

    renderWorkspaceDetailPage('/', 'settings');

    // Matched by its text rather than by role: several things on this page announce themselves as a
    // `status`, including the page and the member list while they load.
    const notice = await screen.findByText(/This workspace is archived/);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Nothing has been deleted');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
  });
});
