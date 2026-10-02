/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocumentList, documentTime, type DocumentListProps } from './DocumentList';
import { CreateDocumentForm } from './CreateDocumentForm';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import type { WorkspaceDocument } from '../api/documentApi';
import { EMPTY_DOCUMENT } from '../api/documentContent';

const listPath = '/api/workspaces/w/documents';
const body = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { origin: 'IMPORTED' },
      content: [{ type: 'text', text: 'Keep this text', marks: [{ type: 'bold' }] }],
    },
  ],
};
const report: WorkspaceDocument = {
  id: 'd',
  title: 'Zebra report',
  revision: 2,
  updatedAt: '2026-10-02T10:00:00Z',
  createdAt: '2026-10-01T10:00:00Z',
  archivedAt: null,
  contentFormat: 'PROSEMIRROR_JSON',
  content: body,
};
const notes: WorkspaceDocument = {
  ...report,
  id: 'n',
  title: 'Alpha notes',
  revision: 5,
  updatedAt: '2026-10-01T10:00:00Z',
};
function json(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(value)),
  } as unknown as Response;
}
function problem(
  status: number,
  code: string,
  detail: string,
  fieldErrors?: unknown,
): Response {
  return {
    ...json(
      { type: 'about:blank', title: code, status, code, detail, errors: fieldErrors },
      status,
    ),
    headers: { get: () => 'application/problem+json' },
  } as unknown as Response;
}
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(
  options: {
    rows?: WorkspaceDocument[];
    full?: WorkspaceDocument;
    listError?: Response;
    renameError?: Response;
    archiveError?: Response;
    createError?: Response;
  } = {},
) {
  let rows = options.rows ?? [report, notes];
  const fetchMock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    if (path === '/api/auth/csrf') return Promise.resolve(json(null, 204));
    if (path === listPath && method === 'GET')
      return Promise.resolve(
        options.listError ??
          json(rows.map(({ content: _content, ...summary }) => summary)),
      );
    if (method === 'PATCH') {
      if (options.renameError) return Promise.resolve(options.renameError);
      const payload = JSON.parse(String(init?.body)) as {
        title: string;
        revision: number;
        content: unknown;
      };
      const updated = {
        ...report,
        title: payload.title,
        content: payload.content,
        revision: payload.revision + 1,
      };
      rows = rows.map((row) => (row.id === 'd' ? updated : row));
      return Promise.resolve(json(updated));
    }
    if (method === 'DELETE') {
      if (options.archiveError) return Promise.resolve(options.archiveError);
      rows = rows.filter((row) => row.id !== 'd');
      return Promise.resolve(json(null, 204));
    }
    if (path === listPath && method === 'POST') {
      if (options.createError) return Promise.resolve(options.createError);
      const payload = JSON.parse(String(init?.body)) as {
        title: string;
        content: unknown;
      };
      const created = { ...report, id: 'new', ...payload };
      rows = [...rows, created];
      return Promise.resolve(json(created, 201));
    }
    if (path === `${listPath}/d`)
      return Promise.resolve(json(options.full ?? { ...report, revision: 7 }));
    throw new Error(`Unexpected ${method} ${path}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
function setup(props: Partial<DocumentListProps> = {}, path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DocumentList workspaceId="w" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const calls = (mock: jest.Mock, method: string) =>
  mock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === method,
  );
async function openRename() {
  fireEvent.click(await screen.findByRole('button', { name: 'Rename Zebra report' }));
  return screen.getByRole('dialog', { name: 'Rename document' });
}

describe('DocumentList', () => {
  it('renders summaries, count, revision and updated time without fetching bodies', async () => {
    const api = stub();
    setup();
    expect(screen.getByRole('status').textContent).toBe('Loading documents…');
    const table = await screen.findByRole('table', { name: 'Documents' });
    expect(screen.getByText('2 documents')).toBeTruthy();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((element) => element.textContent),
    ).toEqual(['Title', 'Revision', 'Updated', 'Actions']);
    expect(within(table).getByText('v2')).toBeTruthy();
    expect(
      within(table).getByText(documentTime(report.updatedAt)).getAttribute('dateTime'),
    ).toBe(report.updatedAt);
    expect(
      screen.getByRole('link', { name: 'Open Zebra report' }).getAttribute('href'),
    ).toBe('/app/workspaces/w/documents/d');
    expect(api.mock.calls.every((call) => String(call[0]) === listPath)).toBe(true);
  });
  it('filters titles case-insensitively, offers clearing and sorts by all supported fields', async () => {
    stub();
    setup();
    await screen.findByRole('table');
    const titles = () =>
      screen.getAllByRole('rowheader').map((element) => element.textContent);
    expect(titles()).toEqual(['Zebra report', 'Alpha notes']);
    fireEvent.change(screen.getByLabelText('Sort documents'), {
      target: { value: 'title' },
    });
    expect(titles()).toEqual(['Alpha notes', 'Zebra report']);
    fireEvent.change(screen.getByLabelText('Sort documents'), {
      target: { value: 'revision' },
    });
    expect(titles()).toEqual(['Alpha notes', 'Zebra report']);
    fireEvent.change(screen.getByLabelText('Search documents'), {
      target: { value: '  ZEBRA  ' },
    });
    expect(titles()).toEqual(['Zebra report']);
    fireEvent.change(screen.getByLabelText('Search documents'), {
      target: { value: 'Missing' },
    });
    expect(screen.getByRole('heading', { name: 'No matching documents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(titles()).toHaveLength(2);
  });
  it('uses title as the tie-breaker and handles invalid timestamps', async () => {
    stub({ rows: [report, { ...notes, revision: 2, updatedAt: report.updatedAt }] });
    setup();
    await screen.findByRole('table');
    expect(screen.getAllByRole('rowheader')[0]?.textContent).toBe('Alpha notes');
    fireEvent.change(screen.getByLabelText('Sort documents'), {
      target: { value: 'revision' },
    });
    expect(screen.getAllByRole('rowheader')[0]?.textContent).toBe('Alpha notes');
    expect(documentTime('invalid')).toBe('invalid');
  });
  it('shows the empty state and offers no mutations to viewers', async () => {
    const api = stub({ rows: [] });
    setup();
    await screen.findByRole('heading', { name: 'Nothing written yet' });
    expect(
      screen.queryByRole('button', {
        name: /New document|Create first document|Rename|Archive/,
      }),
    ).toBeNull();
    expect(calls(api, 'POST')).toHaveLength(0);
  });
  it('keeps the open document marked in the column without table controls', async () => {
    stub();
    setup({ variant: 'column', currentDocumentId: 'd', canEdit: true });
    expect(
      (await screen.findByRole('link', { name: 'Zebra report' })).getAttribute(
        'aria-current',
      ),
    ).toBe('page');
    expect(
      screen.getByRole('link', { name: 'Alpha notes' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Zebra report' })).toBeNull();
  });
  it('reports list failures', async () => {
    stub({ listError: problem(500, 'INTERNAL_ERROR', 'Unavailable') });
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load the documents',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('renames using the latest revision and preserves the original JSON, then refreshes the list', async () => {
    const api = stub();
    setup({ canEdit: true });
    const dialog = await openRename();
    fireEvent.change(within(dialog).getByLabelText('Document title'), {
      target: { value: 'Renamed report' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename document' }));
    await screen.findByRole('link', { name: 'Renamed report' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(String(calls(api, 'PATCH')[0]?.[1].body))).toEqual({
      title: 'Renamed report',
      content: body,
      revision: 7,
      saveKind: 'MANUAL',
    });
    expect(calls(api, 'PATCH')[0]?.[0]).toBe(`${listPath}/d`);
  });
  it('does not submit a blank rename and cancels without a write', async () => {
    const api = stub();
    setup({ canEdit: true });
    const dialog = await openRename();
    fireEvent.change(within(dialog).getByLabelText('Document title'), {
      target: { value: '  ' },
    });
    expect(
      within(dialog).getByRole('button', { name: 'Rename document' }),
    ).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(calls(api, 'PATCH')).toHaveLength(0);
  });
  it.each([
    [problem(409, 'CONFLICT', 'Stale'), 'The document changed'],
    [problem(403, 'FORBIDDEN', 'Editors only'), 'Editors only'],
    [
      problem(400, 'VALIDATION_FAILED', 'Invalid title', [
        { field: 'title', message: 'Too long' },
      ]),
      'Too long',
    ],
  ])('keeps a rejected rename draft visible', async (response, message) => {
    stub({ renameError: response as Response });
    setup({ canEdit: true });
    const dialog = await openRename();
    fireEvent.change(within(dialog).getByLabelText('Document title'), {
      target: { value: 'My draft title' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename document' }));
    await screen.findByText(new RegExp(String(message)));
    expect(screen.getByLabelText('Document title')).toHaveProperty(
      'value',
      'My draft title',
    );
  });
  it('refuses to overwrite unsupported content during rename', async () => {
    const api = stub({
      full: { ...report, content: { type: 'doc', content: [{ type: 'image' }] } },
    });
    setup({ canEdit: true });
    const dialog = await openRename();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename document' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot open');
    expect(calls(api, 'PATCH')).toHaveLength(0);
  });
  it('archives only after confirmation and refreshes the active list', async () => {
    const api = stub();
    setup({ canEdit: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Zebra report' }));
    expect(calls(api, 'DELETE')).toHaveLength(0);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Archive document' })).getByRole(
        'button',
        { name: 'Archive document' },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Zebra report' })).toBeNull(),
    );
    expect(calls(api, 'DELETE')[0]?.[0]).toBe(`${listPath}/d`);
    expect(screen.getByText('1 document')).toBeTruthy();
  });
  it('keeps the document when archiving fails', async () => {
    stub({ archiveError: problem(403, 'FORBIDDEN', 'Editors only') });
    setup({ canEdit: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Zebra report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive document' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Editors only');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('creates from the empty state and opens the returned document', async () => {
    const api = stub({ rows: [] });
    const created = jest.fn();
    setup({ canEdit: true, onCreated: created });
    fireEvent.click(await screen.findByRole('button', { name: 'Create first document' }));
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'First report' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith('new'));
    expect(JSON.parse(String(calls(api, 'POST')[0]?.[1].body))).toEqual({
      title: 'First report',
      content: EMPTY_DOCUMENT,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens and dismisses the New document dialog from a populated list', async () => {
    stub();
    setup({ canEdit: true });
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    expect(screen.getByRole('button', { name: 'Create document' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('supports the shell creation fragment and can close it without changing routes', async () => {
    stub();
    setup({ canEdit: true }, '/documents#create-document-heading');
    await screen.findByRole('dialog', { name: 'New document' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it.each([
    [problem(403, 'FORBIDDEN', 'Editors only'), 'Editors only'],
    [
      problem(400, 'VALIDATION_FAILED', 'Invalid', [
        { field: 'title', message: 'Too long' },
      ]),
      'Too long',
    ],
  ])('displays creation errors without dropping the draft', async (response, message) => {
    stub({ rows: [], createError: response as Response });
    setup({ canEdit: true });
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Keep title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    await screen.findByText(String(message));
    expect(screen.getByLabelText('Document title')).toHaveProperty('value', 'Keep title');
  });
  it('supports standalone form and dialog consumers without success callbacks', async () => {
    stub({ rows: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <CreateDocumentForm workspaceId="w" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Document title')).toHaveProperty('value', ''),
    );
    view.unmount();
    const close = jest.fn();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateDocumentDialog workspaceId="w" open onClose={close} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Document title'), {
      target: { value: 'Second' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
