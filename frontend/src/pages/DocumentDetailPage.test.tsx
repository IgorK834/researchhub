/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DocumentDetailPage } from './DocumentDetailPage';

const WORKSPACE_ID = 'w-1';
const DOCUMENT_ID = 'd-1';
const DOCUMENT_PATH = `/api/workspaces/${WORKSPACE_ID}/documents/${DOCUMENT_ID}`;

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useParams: () => ({ workspaceId: WORKSPACE_ID, documentId: DOCUMENT_ID }),
}));

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly contentFormat: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly content: unknown;
}

function paragraphs(...lines: readonly string[]): unknown {
  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length === 0
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    ),
  };
}

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOCUMENT_ID,
    title: 'Final report',
    contentFormat: 'PROSEMIRROR_JSON',
    revision: 1,
    createdAt: '2026-09-23T10:15:30Z',
    updatedAt: '2026-09-23T10:15:30Z',
    archivedAt: null,
    content: paragraphs('Measurements'),
    ...overrides,
  };
}

function workspaceRow(role: string): unknown {
  return {
    id: WORKSPACE_ID,
    name: 'Electronics Lab',
    description: 'Team 4',
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

function problem(status: number, code: string, detail: string): Response {
  return jsonResponse(
    { type: 'about:blank', title: code, status, detail, code },
    status,
    'application/problem+json',
  );
}

/**
 * A stand-in for the document and workspace endpoints. A save advances the stored revision, so a test can check
 * that the editor sends the new one next time rather than the one it started with.
 */
function stubDocumentApi(options: {
  readonly document?: DocumentRow;
  readonly role?: string;
  readonly documentResponse?: Response;
  readonly saveResponse?: Response;
}): jest.Mock {
  let current = options.document ?? documentRow();

  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    if (path === '/api/auth/csrf') {
      return Promise.resolve(emptyNoContent());
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}` && method === 'GET') {
      return Promise.resolve(
        jsonResponse(workspaceRow(options.role ?? 'OWNER'), 200, 'application/json'),
      );
    }
    if (path === DOCUMENT_PATH && method === 'PATCH') {
      if (options.saveResponse !== undefined) {
        return Promise.resolve(options.saveResponse);
      }
      const body = JSON.parse(String(init?.body)) as {
        title: string;
        content: unknown;
        revision: number;
      };
      current = {
        ...current,
        title: body.title,
        content: body.content,
        revision: body.revision + 1,
      };
      return Promise.resolve(jsonResponse(current, 200, 'application/json'));
    }
    if (path === DOCUMENT_PATH && method === 'DELETE') {
      current = { ...current, archivedAt: '2026-09-24T09:00:00Z' };
      return Promise.resolve(emptyNoContent());
    }
    if (path === DOCUMENT_PATH && method === 'GET') {
      return Promise.resolve(
        options.documentResponse ?? jsonResponse(current, 200, 'application/json'),
      );
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/documents` && method === 'GET') {
      return Promise.resolve(jsonResponse([], 200, 'application/json'));
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderDocumentDetailPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(<DocumentDetailPage />, { wrapper });
}

function savedBodies(
  fetchMock: jest.Mock,
): { title: string; revision: number; content: unknown }[] {
  return fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
    .map(
      (call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body)) as {
          title: string;
          revision: number;
          content: unknown;
        },
    );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('DocumentDetailPage', () => {
  it('shows a loading state before the document arrives', () => {
    stubDocumentApi({});

    renderDocumentDetailPage();

    expect(screen.getByRole('status').textContent).toContain('Loading this document');
  });

  it('shows the title, the text, and the revision', async () => {
    stubDocumentApi({ document: documentRow({ revision: 4 }) });

    renderDocumentDetailPage();

    expect(await screen.findByRole('heading', { name: 'Final report' })).not.toBeNull();
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Final report');
    // The textarea holds the paragraph text from inside the JSON, not the JSON and not HTML.
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'Measurements');
    expect(screen.getByText('Revision 4')).not.toBeNull();
  });

  it('reads multiple paragraphs into the textarea', async () => {
    stubDocumentApi({
      document: documentRow({ content: paragraphs('First', '', 'Second') }),
    });

    renderDocumentDetailPage();

    expect(await screen.findByLabelText('Text')).toHaveProperty(
      'value',
      'First\n\nSecond',
    );
  });

  it('shows a not-found state for a 404 without saying whether the document exists', async () => {
    stubDocumentApi({
      documentResponse: problem(404, 'RESOURCE_NOT_FOUND', 'Document was not found'),
    });

    renderDocumentDetailPage();

    expect(
      await screen.findByRole('heading', { name: 'Document not found' }),
    ).not.toBeNull();
    expect(screen.getByText(/not available/).textContent).toContain(
      'may not have access',
    );
    expect(screen.queryByText(/does not exist/)).toBeNull();
  });

  it('reports a failure that is not a 404 as an error rather than a missing document', async () => {
    stubDocumentApi({
      documentResponse: problem(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
    });

    renderDocumentDetailPage();

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load this document',
    );
    expect(screen.queryByRole('heading', { name: 'Document not found' })).toBeNull();
  });

  it('saves the text as a ProseMirror document and advances the revision', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    fireEvent.change(await screen.findByLabelText('Text'), {
      target: { value: 'Rewritten\n\nWith a second paragraph' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Saved as revision 2/)).not.toBeNull();
    expect(screen.getByText('Revision 2')).not.toBeNull();

    const [firstSave] = savedBodies(fetchMock);
    expect(firstSave?.revision).toBe(1);
    expect(firstSave?.content).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Rewritten' }] },
        { type: 'paragraph' },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'With a second paragraph' }],
        },
      ],
    });
  });

  it('sends the new revision on the next save rather than the one it loaded', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    fireEvent.change(await screen.findByLabelText('Text'), {
      target: { value: 'First edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Second edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 3/);

    expect(savedBodies(fetchMock).map((body) => body.revision)).toEqual([1, 2]);
  });

  it('keeps the text on screen when somebody else saved first', async () => {
    stubDocumentApi({
      saveResponse: problem(
        409,
        'CONFLICT',
        'This document was changed by somebody else. It is now at revision 2, and your copy is at ' +
          'revision 1. Reload it and apply your changes again.',
      ),
    });

    renderDocumentDetailPage();
    fireEvent.change(await screen.findByLabelText('Text'), {
      target: { value: 'My unsaved work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('changed by somebody else');
    // The whole point: the work is still there to copy out of, and the server's version has not replaced it.
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'My unsaved work');
    expect(screen.getByText('Revision 1')).not.toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    ).not.toBeNull();
  });

  it('loads the latest version only when the user asks for it', async () => {
    stubDocumentApi({
      saveResponse: problem(
        409,
        'CONFLICT',
        'This document was changed by somebody else.',
      ),
      document: documentRow({ content: paragraphs('The other version') }),
    });

    renderDocumentDetailPage();
    fireEvent.change(await screen.findByLabelText('Text'), {
      target: { value: 'My unsaved work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Text')).toHaveProperty('value', 'The other version');
    });
  });

  it('does not offer save or archive to a viewer', async () => {
    stubDocumentApi({ role: 'VIEWER' });

    renderDocumentDetailPage();

    expect(await screen.findByLabelText('Text')).toHaveProperty('value', 'Measurements');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
    expect(screen.getByLabelText('Text')).toHaveProperty('readOnly', true);
    expect(screen.getByLabelText('Title')).toHaveProperty('readOnly', true);
  });

  it('offers save and archive to an editor and an owner', async () => {
    for (const role of ['OWNER', 'EDITOR']) {
      stubDocumentApi({ role });
      renderDocumentDetailPage();

      expect(await screen.findByRole('button', { name: 'Save' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Archive document' })).not.toBeNull();

      cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  it('archives a document and then offers no way to change it', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive document' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('archived');
    });
    expect(screen.getByRole('status').textContent).toContain('has not been deleted');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
    // Still rendered, so the text is readable rather than gone.
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'Measurements');

    expect(
      fetchMock.mock.calls.some(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
