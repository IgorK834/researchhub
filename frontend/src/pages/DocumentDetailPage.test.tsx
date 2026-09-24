/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

function problem(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(
    { type: 'about:blank', title: code, status, detail, code, ...extra },
    status,
    'application/problem+json',
  );
}

const STALE_DETAIL =
  'This document was changed by somebody else. It is now at revision 2, and your copy is at ' +
  'revision 1. Reload it and apply your changes again.';

/** A heading, a paragraph with a bold word, and a bullet list: the structure a textarea used to flatten. */
const STRUCTURED: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Method' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Measured with ' },
        { type: 'text', text: 'care', marks: [{ type: 'bold' }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Ten samples' }] },
          ],
        },
      ],
    },
  ],
};

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

/**
 * {@link STRUCTURED} once the editor has touched it. StarterKit's trailing-node rule keeps an empty paragraph
 * after a document that ends in a list, so there is always somewhere to put the cursor below it.
 */
const STRUCTURED_AS_SAVED: JSONContent = {
  ...STRUCTURED,
  content: [...(STRUCTURED.content ?? []), { type: 'paragraph' }],
};

/** The editable element of the document body. Tiptap renders a div with the role and name set on it. */
async function findBody(): Promise<HTMLElement> {
  return screen.findByRole('textbox', { name: 'Text' });
}

/**
 * The live Tiptap editor behind the body. Tiptap attaches it to its element.
 *
 * jsdom has no layout and no real selection, so typing with key events does not reach ProseMirror. A test
 * edits through the editor's own commands instead — the same transactions a keystroke produces, and the same
 * `onUpdate` the page listens to.
 */
function bodyEditor(): Editor {
  const element = screen.getByRole('textbox', { name: 'Text' }) as HTMLElement & {
    editor?: Editor;
  };
  if (element.editor === undefined) {
    throw new Error('The document body is not a Tiptap editor');
  }
  return element.editor;
}

/** Replaces the whole body, the way a user selecting everything and typing would. */
function editBody(content: JSONContent | string): void {
  act(() => {
    bodyEditor().commands.setContent(content);
  });
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
    // The body shows the text from inside the JSON, not the JSON and not HTML source.
    expect((await findBody()).textContent).toBe('Measurements');
    expect(screen.getByText('Revision 4')).not.toBeNull();
  });

  it('opens a paragraph-only document from the textarea editor as it is stored', async () => {
    const stored = paragraphs('First', '', 'Second');
    const fetchMock = stubDocumentApi({ document: documentRow({ content: stored }) });

    renderDocumentDetailPage();
    const body = await findBody();

    expect(body.querySelectorAll('p')).toHaveLength(3);
    expect(bodyEditor().getJSON()).toEqual(stored);
    // Opening is not a save: nothing rewrites the row.
    expect(savedBodies(fetchMock)).toEqual([]);
  });

  it('renders headings, marks, and lists from the stored JSON', async () => {
    stubDocumentApi({ document: documentRow({ content: STRUCTURED }) });

    renderDocumentDetailPage();
    const body = await findBody();

    expect(body.querySelector('h2')?.textContent).toBe('Method');
    expect(body.querySelector('strong')?.textContent).toBe('care');
    expect(body.querySelector('ul li')?.textContent).toBe('Ten samples');
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

  it('saves the editor JSON, not HTML, and advances the revision', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    await findBody();
    editBody(STRUCTURED);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Saved as revision 2/)).not.toBeNull();
    expect(screen.getByText('Revision 2')).not.toBeNull();

    const [firstSave] = savedBodies(fetchMock);
    expect(firstSave?.revision).toBe(1);
    expect(firstSave?.title).toBe('Final report');
    expect(typeof firstSave?.content).toBe('object');
    expect(firstSave?.content).toEqual(STRUCTURED_AS_SAVED);
    expect(JSON.stringify(firstSave?.content)).not.toMatch(/<(h2|strong|ul|li|p)>/);
  });

  it('shows the heading, the bold word, and the list again after leaving and reopening', async () => {
    stubDocumentApi({});

    renderDocumentDetailPage();
    await findBody();
    editBody(STRUCTURED);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    // Leave the page and come back with a fresh cache, so the document is read from the stub's stored copy.
    cleanup();
    renderDocumentDetailPage();
    const body = await findBody();

    expect(screen.getByText('Revision 2')).not.toBeNull();
    expect(body.querySelector('h2')?.textContent).toBe('Method');
    expect(body.querySelector('strong')?.textContent).toBe('care');
    expect(body.querySelector('ul li')?.textContent).toBe('Ten samples');
    expect(bodyEditor().getJSON()).toEqual(STRUCTURED_AS_SAVED);
  });

  it('saves a title change with the body untouched rather than flattened', async () => {
    const fetchMock = stubDocumentApi({ document: documentRow({ content: STRUCTURED }) });

    renderDocumentDetailPage();
    await findBody();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    const [save] = savedBodies(fetchMock);
    expect(save?.title).toBe('Renamed');
    expect(save?.content).toEqual(STRUCTURED);
  });

  it('sends the new revision on the next save rather than the one it loaded', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    await findBody();
    editBody('First edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    editBody('Second edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 3/);

    expect(savedBodies(fetchMock).map((body) => body.revision)).toEqual([1, 2]);
  });

  it('keeps the editor as the user left it when somebody else saved first', async () => {
    stubDocumentApi({
      saveResponse: problem(409, 'CONFLICT', STALE_DETAIL, { currentRevision: 2 }),
    });

    renderDocumentDetailPage();
    await findBody();
    editBody({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'My ' },
            { type: 'text', text: 'unsaved', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' work' },
          ],
        },
      ],
    });
    const beforeSave = bodyEditor().getJSON();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('changed by somebody else');
    // The structured revision is shown without parsing it out of the sentence.
    expect(
      screen.getByText(/The saved document is now at revision 2/).textContent,
    ).toContain('based on revision 1');
    // The whole point: the work is still there, marks included, and the server's version has not replaced it.
    expect((await findBody()).textContent).toBe('My unsaved work');
    expect(bodyEditor().getJSON()).toEqual(beforeSave);
    expect(bodyEditor().isEditable).toBe(true);
    expect(screen.getByText('Revision 1')).not.toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    ).not.toBeNull();
  });

  it('handles a conflict that carries no currentRevision from the detail alone', async () => {
    stubDocumentApi({
      saveResponse: problem(
        409,
        'CONFLICT',
        'This document was changed by somebody else.',
      ),
    });

    renderDocumentDetailPage();
    await findBody();
    editBody('My unsaved work');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'changed by somebody else',
    );
    expect(screen.queryByText(/The saved document is now at revision/)).toBeNull();
    expect((await findBody()).textContent).toBe('My unsaved work');
    expect(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    ).not.toBeNull();
  });

  it('loads the latest version only when the user asks for it', async () => {
    stubDocumentApi({
      saveResponse: problem(409, 'CONFLICT', STALE_DETAIL, { currentRevision: 2 }),
      document: documentRow({ content: paragraphs('The other version') }),
    });

    renderDocumentDetailPage();
    await findBody();
    editBody('My unsaved work');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect((await findBody()).textContent).toBe('My unsaved work');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Text' }).textContent).toBe(
        'The other version',
      );
    });
  });

  it('refuses to edit a body this editor cannot open, instead of opening it empty', async () => {
    stubDocumentApi({
      document: documentRow({
        content: {
          type: 'doc',
          content: [{ type: 'image', attrs: { src: 'diagram.png' } }],
        },
      }),
    });

    renderDocumentDetailPage();

    expect((await screen.findByRole('alert')).textContent).toContain('cannot open');
    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows a viewer the document read-only, with no toolbar and no save', async () => {
    stubDocumentApi({ role: 'VIEWER', document: documentRow({ content: STRUCTURED }) });

    renderDocumentDetailPage();

    const body = await findBody();
    expect(body.querySelector('h2')?.textContent).toBe('Method');
    expect(body.getAttribute('contenteditable')).toBe('false');
    expect(body.getAttribute('aria-readonly')).toBe('true');
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
    expect(screen.getByLabelText('Title')).toHaveProperty('readOnly', true);
  });

  it('offers the toolbar, save, and archive to an editor and an owner', async () => {
    for (const role of ['OWNER', 'EDITOR']) {
      stubDocumentApi({ role });
      renderDocumentDetailPage();

      expect(await screen.findByRole('button', { name: 'Save' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Archive document' })).not.toBeNull();
      expect(screen.getByRole('toolbar', { name: 'Formatting' })).not.toBeNull();
      expect((await findBody()).getAttribute('contenteditable')).toBe('true');

      cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  it('formats the selection from the toolbar', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    await findBody();
    act(() => {
      bodyEditor().commands.selectAll();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    expect(savedBodies(fetchMock)[0]?.content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Measurements', marks: [{ type: 'bold' }] }],
        },
        { type: 'paragraph' },
      ],
    });
  });

  it('inserts a small table from the toolbar', async () => {
    const fetchMock = stubDocumentApi({});

    renderDocumentDetailPage();
    await findBody();
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved as revision 2/);

    const table = (savedBodies(fetchMock)[0]?.content as JSONContent).content?.find(
      (node) => node.type === 'table',
    );
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content).toHaveLength(3);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
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
    // Still rendered, so the text is readable rather than gone — and no longer editable.
    const body = await findBody();
    expect(body.textContent).toBe('Measurements');
    expect(body.getAttribute('contenteditable')).toBe('false');

    expect(
      fetchMock.mock.calls.some(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
