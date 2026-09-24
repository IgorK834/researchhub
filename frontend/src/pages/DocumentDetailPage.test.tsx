/**
 * @jest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor, JSONContent } from '@tiptap/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { DocumentDetailPage } from './DocumentDetailPage';

const WORKSPACE_ID = 'w-1';
const DOCUMENT_ID = 'd-1';
const DOCUMENT_PATH = `/api/workspaces/${WORKSPACE_ID}/documents/${DOCUMENT_ID}`;
const VERSIONS_PATH = `${DOCUMENT_PATH}/versions`;

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual<typeof import('react-router-dom')>('react-router-dom'),
  useParams: () => ({ workspaceId: WORKSPACE_ID, documentId: DOCUMENT_ID }),
  useNavigate: () => mockNavigate,
}));

// Real timers with short delays: Tiptap and Testing Library both schedule their own work, and a fake clock
// would have to drive all of it. The controller's own timing rules are tested with fake timers separately.
jest.mock('../features/documents/autosave/autosaveTiming', () => ({
  AUTOSAVE_TIMING: { debounceMs: 30, maxWaitMs: 300 },
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

interface VersionRow {
  readonly id: string;
  readonly revision: number;
  readonly reason: string;
  readonly restoredFromVersionId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly contentFormat: string;
  readonly content: unknown;
}

interface SaveBody {
  readonly title: string;
  readonly content: unknown;
  readonly revision: number;
  readonly saveKind: string;
}

function paragraphs(...lines: readonly string[]): JSONContent {
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
 * {@link STRUCTURED} once the editor has touched it. StarterKit's trailing-node rule keeps an empty paragraph
 * after a document that ends in a list, so there is always somewhere to put the cursor below it.
 */
const STRUCTURED_AS_SAVED: JSONContent = {
  ...STRUCTURED,
  content: [...(STRUCTURED.content ?? []), { type: 'paragraph' }],
};

/**
 * A stand-in for the document, version, and workspace endpoints. A save advances the stored revision and, when
 * it is manual, records a version — the same rules as the server, so a test can follow a document through
 * several saves and a restore.
 *
 * `saveResponses` are used, in order, for the first saves instead of the normal behaviour; `offline` makes every
 * save fail before reaching a server.
 */
function stubDocumentApi(options: {
  readonly document?: DocumentRow;
  readonly role?: string;
  readonly documentResponse?: Response;
  readonly saveResponses?: readonly Response[];
  readonly offline?: () => boolean;
}): jest.Mock {
  let current = options.document ?? documentRow();
  const queuedSaves = [...(options.saveResponses ?? [])];
  const versions: VersionRow[] = [
    {
      id: 'v-1',
      revision: 1,
      reason: 'CREATED',
      restoredFromVersionId: null,
      createdBy: 'u-1',
      createdAt: '2026-09-23T10:15:30Z',
      contentFormat: 'PROSEMIRROR_JSON',
      content: current.content,
    },
  ];
  const summary = (version: VersionRow): unknown => {
    const { content: _content, contentFormat: _format, ...rest } = version;
    return rest;
  };
  const record = (reason: string, restoredFrom: string | null): void => {
    versions.unshift({
      id: `v-${String(current.revision)}`,
      revision: current.revision,
      reason,
      restoredFromVersionId: restoredFrom,
      createdBy: 'u-1',
      createdAt: '2026-09-24T09:00:00Z',
      contentFormat: 'PROSEMIRROR_JSON',
      content: current.content,
    });
  };

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
      if (options.offline?.() === true) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      const queued = queuedSaves.shift();
      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      const body = JSON.parse(String(init?.body)) as SaveBody;
      if (body.revision !== current.revision) {
        return Promise.resolve(
          problem(409, 'CONFLICT', 'Changed by somebody else', {
            currentRevision: current.revision,
          }),
        );
      }
      current = {
        ...current,
        title: body.title,
        content: body.content,
        revision: body.revision + 1,
      };
      if (body.saveKind === 'MANUAL') {
        record('MANUAL_SAVE', null);
      }
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
    if (path === VERSIONS_PATH && method === 'GET') {
      return Promise.resolve(
        jsonResponse(versions.map(summary), 200, 'application/json'),
      );
    }
    const restore = /^.*\/versions\/([^/]+)\/restore$/.exec(path);
    if (restore !== null && method === 'POST') {
      const source = versions.find((version) => version.id === restore[1]);
      const body = JSON.parse(String(init?.body)) as { revision: number };
      if (source === undefined || body.revision !== current.revision) {
        return Promise.resolve(problem(409, 'CONFLICT', 'Changed by somebody else'));
      }
      current = { ...current, content: source.content, revision: current.revision + 1 };
      record('RESTORE', source.id);
      return Promise.resolve(jsonResponse(current, 200, 'application/json'));
    }
    const version = /^.*\/versions\/([^/]+)$/.exec(path);
    if (version !== null && method === 'GET') {
      const found = versions.find((entry) => entry.id === version[1]);
      return Promise.resolve(
        found === undefined
          ? problem(404, 'RESOURCE_NOT_FOUND', 'Document version was not found')
          : jsonResponse(found, 200, 'application/json'),
      );
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/documents` && method === 'GET') {
      return Promise.resolve(
        jsonResponse(
          current.archivedAt === null
            ? [
                { ...current, content: undefined },
                { ...documentRow({ id: 'd-2', title: 'Lab notes' }), content: undefined },
              ]
            : [],
          200,
          'application/json',
        ),
      );
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/documents` && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { title: string; content: unknown };
      return Promise.resolve(
        jsonResponse(
          documentRow({ id: 'd-new', title: body.title, content: body.content }),
          201,
          'application/json',
        ),
      );
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderDocumentDetailPage(): { unmount: () => void } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<DocumentDetailPage />, { wrapper });
}

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

/** The one-word save state, from the live region that announces it. */
function saveState(): string {
  const region = screen
    .getAllByRole('status')
    .find((element) => element.querySelector('strong') !== null);
  return region?.querySelector('strong')?.textContent ?? '';
}

async function waitForSaveState(expected: string): Promise<void> {
  await waitFor(() => {
    expect(saveState()).toBe(expected);
  });
}

function savedBodies(fetchMock: jest.Mock): SaveBody[] {
  return fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
    .map(
      (call) =>
        JSON.parse(String((call[1] as RequestInit | undefined)?.body)) as SaveBody,
    );
}

function requestsTo(fetchMock: jest.Mock, method: string, path: string): number {
  return fetchMock.mock.calls.filter(
    (call) =>
      String(call[0]) === path &&
      ((call[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length;
}

/** Lets autosave's timers run out, inside act() because they update React state when they fire. */
async function idle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function openHistory(): Promise<HTMLElement> {
  fireEvent.click(screen.getByText('Version history'));
  // jsdom does not toggle <details> on a summary click, so open it the way a browser would.
  const details = screen.getByText('Version history').closest('details');
  if (details === null) {
    throw new Error('No history panel');
  }
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  return screen.findByRole('list', { name: 'Versions' });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockNavigate.mockReset();
  jest.restoreAllMocks();
});

describe('DocumentDetailPage', () => {
  describe('reading', () => {
    it('shows a loading state before the document arrives', () => {
      stubDocumentApi({});

      renderDocumentDetailPage();

      expect(screen.getByText('Loading this document…')).not.toBeNull();
    });

    it('shows the title, the text, and that it is saved', async () => {
      stubDocumentApi({ document: documentRow({ revision: 4 }) });

      renderDocumentDetailPage();

      expect(await screen.findByRole('heading', { name: 'Final report' })).not.toBeNull();
      expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Final report');
      // The body shows the text from inside the JSON, not the JSON and not HTML source.
      expect((await findBody()).textContent).toBe('Measurements');
      expect(saveState()).toBe('Saved');
      expect(screen.getByText(/revision 4/)).not.toBeNull();
    });

    it('opens a paragraph-only document from the textarea editor as it is stored', async () => {
      const stored = paragraphs('First', '', 'Second');
      const fetchMock = stubDocumentApi({ document: documentRow({ content: stored }) });

      renderDocumentDetailPage();
      const body = await findBody();

      expect(body.querySelectorAll('p')).toHaveLength(3);
      expect(bodyEditor().getJSON()).toEqual(stored);
      await idle(100);
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

      expect(await screen.findByText(/Could not load this document/)).not.toBeNull();
      expect(screen.queryByRole('heading', { name: 'Document not found' })).toBeNull();
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

      expect(await screen.findByText(/cannot open/)).not.toBeNull();
      expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    });
  });

  describe('autosave', () => {
    it('saves the editor JSON after typing pauses, as an autosave, and says so', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      editBody(STRUCTURED);

      expect(saveState()).toBe('Unsaved changes');
      await waitForSaveState('Saved');
      expect(screen.getByText(/revision 2/)).not.toBeNull();

      const [save] = savedBodies(fetchMock);
      expect(save?.saveKind).toBe('AUTOSAVE');
      expect(save?.revision).toBe(1);
      expect(save?.title).toBe('Final report');
      expect(typeof save?.content).toBe('object');
      expect(save?.content).toEqual(STRUCTURED_AS_SAVED);
      expect(JSON.stringify(save?.content)).not.toMatch(/<(h2|strong|ul|li|p)>/);
    });

    it('sends one request for a burst of edits, not one per keystroke', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      for (const text of ['M', 'Me', 'Mea', 'Meas', 'Measu', 'Measur', 'Measure']) {
        editBody(text);
      }
      await waitForSaveState('Saved');
      await idle(100);

      expect(savedBodies(fetchMock)).toHaveLength(1);
      expect(savedBodies(fetchMock)[0]?.content).toEqual(paragraphs('Measure'));
    });

    it('sends the new revision on the next save rather than the one it loaded', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      editBody('First edit');
      await waitForSaveState('Saved');
      editBody('Second edit');
      await waitFor(() => {
        expect(savedBodies(fetchMock)).toHaveLength(2);
      });
      await waitForSaveState('Saved');

      expect(savedBodies(fetchMock).map((body) => body.revision)).toEqual([1, 2]);
      expect(screen.getByText(/revision 3/)).not.toBeNull();
    });

    it('saves a title change with the body untouched rather than flattened', async () => {
      const fetchMock = stubDocumentApi({
        document: documentRow({ content: STRUCTURED }),
      });

      renderDocumentDetailPage();
      await findBody();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed' } });
      await waitForSaveState('Saved');

      const [save] = savedBodies(fetchMock);
      expect(save?.title).toBe('Renamed');
      expect(save?.content).toEqual(STRUCTURED);
      expect(await screen.findByRole('heading', { name: 'Renamed' })).not.toBeNull();
    });

    it('does not save a blank title, and says a title is required', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
      await idle(100);

      expect(savedBodies(fetchMock)).toHaveLength(0);
      expect(saveState()).toBe('Unsaved changes');
      expect(screen.getByText('A title is required.')).not.toBeNull();
      expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByRole('button', { name: 'Save version' })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('saves what is pending when the user leaves the document', async () => {
      const fetchMock = stubDocumentApi({});

      const { unmount } = renderDocumentDetailPage();
      await findBody();
      editBody('Typed just before leaving');
      unmount();

      await waitFor(() => {
        expect(savedBodies(fetchMock)).toHaveLength(1);
      });
      expect(savedBodies(fetchMock)[0]?.content).toEqual(
        paragraphs('Typed just before leaving'),
      );
    });

    it('shows the saved content again after leaving and reopening', async () => {
      stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      editBody(STRUCTURED);
      await waitForSaveState('Saved');

      // Leave and come back with a fresh cache, so the document is read from the stub's stored copy.
      cleanup();
      renderDocumentDetailPage();
      const body = await findBody();

      expect(screen.getByText(/revision 2/)).not.toBeNull();
      expect(body.querySelector('h2')?.textContent).toBe('Method');
      expect(body.querySelector('strong')?.textContent).toBe('care');
      expect(body.querySelector('ul li')?.textContent).toBe('Ten samples');
      expect(bodyEditor().getJSON()).toEqual(STRUCTURED_AS_SAVED);
    });

    it('saves a version on request, as a manual save', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
      await waitForSaveState('Saved');

      expect(savedBodies(fetchMock)).toEqual([
        {
          title: 'Final report',
          content: paragraphs('Measurements'),
          revision: 1,
          saveKind: 'MANUAL',
        },
      ]);
    });
  });

  describe('failures', () => {
    it('shows a failed save, keeps the text, and saves once retried', async () => {
      let offline = true;
      const fetchMock = stubDocumentApi({ offline: () => offline });

      renderDocumentDetailPage();
      await findBody();
      editBody('Written while offline');

      await waitForSaveState('Save failed');
      expect(screen.getByRole('alert').textContent).toContain(
        'Could not reach the ResearchHub API',
      );
      expect(screen.getByRole('alert').textContent).toContain('have not been saved');
      expect((await findBody()).textContent).toBe('Written while offline');

      offline = false;
      fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
      await waitForSaveState('Saved');
      expect(savedBodies(fetchMock).at(-1)?.content).toEqual(
        paragraphs('Written while offline'),
      );
    });

    it('retries a failed save when the browser comes back online', async () => {
      let offline = true;
      stubDocumentApi({ offline: () => offline });

      renderDocumentDetailPage();
      await findBody();
      editBody('Written while offline');
      await waitForSaveState('Save failed');

      offline = false;
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      await waitForSaveState('Saved');
    });

    it('asks before closing the tab while edits are unsaved', async () => {
      stubDocumentApi({ offline: () => true });

      renderDocumentDetailPage();
      await findBody();
      const clean = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(clean);
      expect(clean.defaultPrevented).toBe(false);

      editBody('Not saved yet');
      await waitForSaveState('Save failed');
      const dirty = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
    });

    it('shows a title the server refused next to the title', async () => {
      stubDocumentApi({
        saveResponses: [
          jsonResponse(
            {
              type: 'about:blank',
              title: 'Validation failed',
              status: 400,
              detail: 'Request validation failed',
              code: 'VALIDATION_FAILED',
              errors: [{ field: 'title', message: 'size must be between 0 and 500' }],
            },
            400,
            'application/problem+json',
          ),
        ],
      });

      renderDocumentDetailPage();
      await findBody();
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'x'.repeat(501) },
      });

      await waitForSaveState('Save failed');
      expect(screen.getByText('size must be between 0 and 500')).not.toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('did not accept');
    });

    it('keeps the editor as the user left it when somebody else saved first', async () => {
      const fetchMock = stubDocumentApi({
        saveResponses: [problem(409, 'CONFLICT', STALE_DETAIL, { currentRevision: 2 })],
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

      await waitForSaveState('Conflict');
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('changed by somebody else');
      // The structured revision is shown without parsing it out of the sentence.
      expect(alert.textContent).toContain('The saved document is now at revision 2');
      expect(alert.textContent).toContain('based on revision 1');
      // The whole point: the work is still there, marks included, and the server's version has not replaced it.
      expect((await findBody()).textContent).toBe('My unsaved work');
      expect(bodyEditor().getJSON()).toEqual(beforeSave);
      expect(bodyEditor().isEditable).toBe(true);

      // And autosave has stopped: more typing is kept but not sent.
      editBody('My unsaved work, continued');
      await idle(100);
      expect(savedBodies(fetchMock)).toHaveLength(1);
      expect(saveState()).toBe('Conflict');
    });

    it('handles a conflict that carries no currentRevision from the detail alone', async () => {
      stubDocumentApi({
        saveResponses: [
          problem(409, 'CONFLICT', 'This document was changed by somebody else.'),
        ],
      });

      renderDocumentDetailPage();
      await findBody();
      editBody('My unsaved work');

      await waitForSaveState('Conflict');
      expect(screen.getByRole('alert').textContent).toContain('changed by somebody else');
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
        saveResponses: [problem(409, 'CONFLICT', STALE_DETAIL, { currentRevision: 2 })],
        document: documentRow({ content: paragraphs('The other version') }),
      });

      renderDocumentDetailPage();
      await findBody();
      editBody('My unsaved work');
      await waitForSaveState('Conflict');
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
      expect(saveState()).toBe('Saved');
    });
  });

  describe('permissions and archiving', () => {
    it('shows a viewer the document read-only, with no toolbar, save, or restore', async () => {
      stubDocumentApi({ role: 'VIEWER', document: documentRow({ content: STRUCTURED }) });

      renderDocumentDetailPage();

      const body = await findBody();
      expect(body.querySelector('h2')?.textContent).toBe('Method');
      expect(body.getAttribute('contenteditable')).toBe('false');
      expect(body.getAttribute('aria-readonly')).toBe('true');
      expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create document' })).toBeNull();
      expect(screen.getByLabelText('Title')).toHaveProperty('readOnly', true);

      const versions = await openHistory();
      expect(within(versions).getByText(/Revision 1 · Created/)).not.toBeNull();
      expect(within(versions).queryByRole('button', { name: /^Restore/ })).toBeNull();
    });

    it('offers the toolbar, save, and archive to an editor and an owner', async () => {
      for (const role of ['OWNER', 'EDITOR']) {
        stubDocumentApi({ role });
        renderDocumentDetailPage();

        expect(
          await screen.findByRole('button', { name: 'Save version' }),
        ).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Archive document' })).not.toBeNull();
        expect(screen.getByRole('toolbar', { name: 'Formatting' })).not.toBeNull();
        expect((await findBody()).getAttribute('contenteditable')).toBe('true');

        cleanup();
        globalThis.fetch = originalFetch;
      }
    });

    it('does not offer archiving while edits are unsaved', async () => {
      stubDocumentApi({ offline: () => true });

      renderDocumentDetailPage();
      await findBody();
      editBody('Pending');

      expect(screen.getByRole('button', { name: 'Archive document' })).toHaveProperty(
        'disabled',
        true,
      );
    });

    it('archives a document and then offers no way to change it', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      fireEvent.click(screen.getByRole('button', { name: 'Archive document' }));

      await waitFor(() => {
        expect(screen.getByText(/This document is archived/)).not.toBeNull();
      });
      expect(screen.getByText(/has not been deleted/)).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Archive document' })).toBeNull();
      // Still rendered, so the text is readable rather than gone — and no longer editable.
      const body = await findBody();
      expect(body.textContent).toBe('Measurements');
      await waitFor(() => {
        expect(body.getAttribute('contenteditable')).toBe('false');
      });
      expect(requestsTo(fetchMock, 'DELETE', DOCUMENT_PATH)).toBe(1);
    });
  });

  describe('formatting', () => {
    it('formats the selection from the toolbar', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      act(() => {
        bodyEditor().commands.selectAll();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
      fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
      await waitForSaveState('Saved');

      expect(savedBodies(fetchMock).at(-1)?.content).toEqual({
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

    it('runs every toolbar command against the document schema', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
      const press = (name: string): void => {
        fireEvent.click(within(toolbar).getByRole('button', { name }));
      };
      act(() => {
        bodyEditor().commands.selectAll();
      });

      press('Italic');
      expect(
        within(toolbar)
          .getByRole('button', { name: 'Italic' })
          .getAttribute('aria-pressed'),
      ).toBe('true');
      press('Heading 2');
      expect(bodyEditor().getJSON().content?.[0]?.type).toBe('heading');
      // Toggled back: a list item's first child must be a paragraph, not a heading.
      press('Heading 2');
      press('Bullet list');
      expect(bodyEditor().getJSON().content?.[0]?.type).toBe('bulletList');
      press('Numbered list');
      expect(bodyEditor().getJSON().content?.[0]?.type).toBe('orderedList');
      press('Insert table');
      expect(within(toolbar).getByRole('button', { name: 'Add row' })).toHaveProperty(
        'disabled',
        false,
      );
      press('Add row');
      press('Add column');
      const table = (bodyEditor().getJSON() as JSONContent).content?.find(
        (node) => node.type === 'table',
      );
      expect(table?.content).toHaveLength(4);
      expect(table?.content?.[0]?.content).toHaveLength(4);
      press('Delete table');
      expect(
        bodyEditor()
          .getJSON()
          .content?.some((node) => node.type === 'table'),
      ).toBe(false);
      press('Undo');
      expect(
        bodyEditor()
          .getJSON()
          .content?.some((node) => node.type === 'table'),
      ).toBe(true);
      press('Redo');
      expect(
        bodyEditor()
          .getJSON()
          .content?.some((node) => node.type === 'table'),
      ).toBe(false);

      await waitForSaveState('Saved');
      // What was saved is what the editor holds after the last command.
      await waitFor(() => {
        expect(savedBodies(fetchMock).at(-1)?.content).toEqual(bodyEditor().getJSON());
      });
    });

    it('inserts a small table from the toolbar', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
      await waitForSaveState('Saved');

      const table = (savedBodies(fetchMock).at(-1)?.content as JSONContent).content?.find(
        (node) => node.type === 'table',
      );
      expect(table?.content).toHaveLength(3);
      expect(table?.content?.[0]?.content).toHaveLength(3);
      expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    });
  });

  describe('version history', () => {
    it('lists the versions only once opened', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      expect(requestsTo(fetchMock, 'GET', VERSIONS_PATH)).toBe(0);

      const versions = await openHistory();

      expect(within(versions).getByText(/Revision 1 · Created/)).not.toBeNull();
    });

    it('previews a version read-only', async () => {
      stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      editBody('Rewritten');
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
      await waitForSaveState('Saved');
      const versions = await openHistory();
      await within(versions).findByText(/Revision 2 · Saved version/);

      fireEvent.click(
        within(versions).getByRole('button', { name: 'Preview revision 1' }),
      );

      const preview = await screen.findByRole('textbox', { name: 'Text of revision 1' });
      await waitFor(() => {
        expect(preview.textContent).toBe('Measurements');
      });
      expect(preview.getAttribute('contenteditable')).toBe('false');
      // The document being edited is untouched by looking at history.
      expect(screen.getByRole('textbox', { name: 'Text' }).textContent).toBe('Rewritten');
    });

    it('restores an old version as a new revision after confirmation', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      editBody('Rewritten');
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
      await waitForSaveState('Saved');
      const versions = await openHistory();
      await within(versions).findByText(/Revision 2 · Saved version/);

      fireEvent.click(
        within(versions).getByRole('button', { name: 'Restore revision 1' }),
      );
      expect(
        within(versions).getByText(/It becomes revision 3; nothing is deleted/),
      ).not.toBeNull();
      fireEvent.click(
        within(versions).getByRole('button', { name: 'Confirm restore of revision 1' }),
      );

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Text' }).textContent).toBe(
          'Measurements',
        );
      });
      expect(saveState()).toBe('Saved');
      expect(screen.getByText(/revision 3/)).not.toBeNull();

      const restoreCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).endsWith('/versions/v-1/restore'),
      );
      expect(JSON.parse(String((restoreCall?.[1] as RequestInit).body))).toEqual({
        revision: 2,
      });

      const updated = await openHistory();
      expect(await within(updated).findByText(/Revision 3 · Restored/)).not.toBeNull();
      expect(within(updated).getByText(/Revision 2 · Saved version/)).not.toBeNull();
      expect(within(updated).getByText(/Revision 1 · Created/)).not.toBeNull();
    });

    it('can cancel a restore', async () => {
      const fetchMock = stubDocumentApi({});

      renderDocumentDetailPage();
      await findBody();
      const versions = await openHistory();
      fireEvent.click(
        await within(versions).findByRole('button', { name: 'Restore revision 1' }),
      );
      fireEvent.click(within(versions).getByRole('button', { name: 'Cancel' }));

      expect(
        within(versions).getByRole('button', { name: 'Restore revision 1' }),
      ).not.toBeNull();
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/restore')),
      ).toBe(false);
    });

    it('does not offer a restore while edits are unsaved', async () => {
      stubDocumentApi({ offline: () => true });

      renderDocumentDetailPage();
      await findBody();
      const versions = await openHistory();
      await within(versions).findByText(/Revision 1 · Created/);
      editBody('Unsaved');

      expect(
        within(versions).getByRole('button', { name: 'Restore revision 1' }),
      ).toHaveProperty('disabled', true);
      expect(
        screen.getByText('Restoring is available once your changes are saved.'),
      ).not.toBeNull();
    });
  });

  describe('workspace shell', () => {
    it('lists the workspace documents beside the editor, marking the open one', async () => {
      stubDocumentApi({});

      renderDocumentDetailPage();
      const nav = await screen.findByRole('navigation', { name: 'Workspace documents' });

      const current = await within(nav).findByRole('link', { name: 'Final report' });
      expect(current.getAttribute('aria-current')).toBe('page');
      const other = within(nav).getByRole('link', { name: 'Lab notes' });
      expect(other.getAttribute('aria-current')).toBeNull();
      expect(other.getAttribute('href')).toBe(
        `/app/workspaces/${WORKSPACE_ID}/documents/d-2`,
      );
      expect(
        within(nav).getByRole('link', { name: 'Back to the workspace' }),
      ).not.toBeNull();
    });

    it('creates a document from the side and opens it', async () => {
      stubDocumentApi({});

      renderDocumentDetailPage();
      const nav = await screen.findByRole('navigation', { name: 'Workspace documents' });
      fireEvent.change(await within(nav).findByLabelText('Document title'), {
        target: { value: 'Appendix' },
      });
      fireEvent.click(within(nav).getByRole('button', { name: 'Create document' }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          `/app/workspaces/${WORKSPACE_ID}/documents/d-new`,
        );
      });
    });
  });
});
