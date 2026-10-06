/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentHistory, type DocumentHistoryProps } from './DocumentHistory';
import type { DocumentVersion, WorkspaceDocument } from '../api/documentApi';

const content = (value: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
});
const current: WorkspaceDocument = {
  id: 'd',
  title: 'Report',
  revision: 6,
  contentFormat: 'PROSEMIRROR_JSON',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-02T10:00:00Z',
  archivedAt: null,
  content: content('Current text'),
};
const versions: DocumentVersion[] = (
  ['AI_ACCEPTANCE', 'RESTORE', 'AUTOSAVE_CHECKPOINT', 'MANUAL_SAVE', 'CREATED'] as const
).map((reason, i) => ({
  id: `v${5 - i}`,
  revision: 5 - i,
  reason,
  createdBy: i === 4 ? 'missing' : 'u',
  createdAt: i === 4 ? 'unknown' : current.createdAt,
  restoredFromVersionId: reason === 'RESTORE' ? 'v1' : null,
  contentFormat: 'PROSEMIRROR_JSON',
  content: content(`Version ${5 - i}`),
}));
function json(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => (status >= 400 ? 'application/problem+json' : 'application/json'),
    },
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(value)),
  } as unknown as Response;
}
const failure = json(
  {
    type: 'about:blank',
    status: 403,
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'No access',
  },
  403,
);
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(
  options: {
    rows?: DocumentVersion[];
    listError?: boolean;
    previewError?: boolean;
    previewContent?: unknown;
    restoreError?: boolean;
    snapshotError?: boolean;
  } = {},
) {
  const api = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/auth/csrf') return Promise.resolve(json(null, 204));
    if (path.endsWith('/snapshots'))
      return Promise.resolve(
        options.snapshotError
          ? failure
          : json(
              {
                ...versions[0],
                id: 'named',
                reason: 'MANUAL_SNAPSHOT',
                name: 'Before review',
              },
              201,
            ),
      );
    if (path.endsWith('/restore'))
      return Promise.resolve(
        options.restoreError
          ? failure
          : json({ ...current, revision: 7, content: content('Restored') }),
      );
    if (path.endsWith('/versions'))
      return Promise.resolve(
        options.listError ? failure : json(options.rows ?? versions),
      );
    const version = versions.find((entry) => path.endsWith(`/${entry.id}`));
    if (version)
      return Promise.resolve(
        options.previewError
          ? failure
          : json({ ...version, content: options.previewContent ?? version.content }),
      );
    throw new Error(`Unexpected ${init?.method ?? 'GET'} ${path}`);
  });
  globalThis.fetch = api as unknown as typeof fetch;
  return api;
}
function setup(overrides: Partial<DocumentHistoryProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const props: DocumentHistoryProps = {
    workspaceId: 'w',
    documentId: 'd',
    revision: 6,
    currentDocument: current,
    authors: [{ userId: 'u', name: 'Ada Lovelace' }],
    canRestore: true,
    restoreBlockedReason: null,
    onRestored: jest.fn(),
    expanded: true,
    ...overrides,
  };
  const scene = (next: DocumentHistoryProps) => (
    <QueryClientProvider client={client}>
      <DocumentHistory {...next} />
    </QueryClientProvider>
  );
  const result = render(scene(props));
  return {
    ...result,
    props,
    update: (next: Partial<DocumentHistoryProps>) =>
      result.rerender(scene({ ...props, ...next })),
  };
}
it('loads on demand and shows reason, author, timestamp, revision and a selected restore point', async () => {
  const api = stub();
  const { container } = setup({ expanded: undefined });
  expect(api).not.toHaveBeenCalled();
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  const list = await screen.findByRole('list', { name: 'Versions' });
  expect(within(list).getAllByText('Ada Lovelace', { exact: false })).toHaveLength(4);
  expect(
    within(list).getByText('Unknown author', { exact: false }).textContent,
  ).toContain('unknown');
  for (const label of [
    'AI suggestion accepted',
    'Restored',
    'Autosave checkpoint',
    'Saved version',
    'Created',
  ])
    expect(within(list).getByText(label, { exact: true })).not.toBeNull();
  fireEvent.click(within(list).getByRole('button', { name: 'Preview revision 2' }));
  await screen.findByText('Previewing v2, compared with current (v6)');
  expect(
    within(list)
      .getByRole('button', { name: 'Preview revision 2' })
      .closest('li')
      ?.getAttribute('data-selected'),
  ).toBe('true');
  fireEvent.click(within(list).getByRole('button', { name: 'Preview revision 2' }));
  expect(screen.queryByRole('region', { name: 'Version differences' })).toBeNull();
});
it('refreshes restore points when opened again even within the application freshness window', async () => {
  stub();
  const { update } = setup();
  await screen.findByRole('button', { name: 'Preview revision 1' });
  const api = stub({ rows: [{ ...versions[0]!, id: 'v6', revision: 6 }, ...versions] });
  update({ expanded: false });
  update({ expanded: true });
  await screen.findByRole('button', { name: 'Preview revision 6' });
  expect(api).toHaveBeenCalled();
});
it('portals the comparison and returns to the open editor when history is closed', async () => {
  stub();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const changed = jest.fn();
  const { update, unmount } = setup({ previewHost: host, onPreviewChange: changed });
  fireEvent.click(await screen.findByRole('button', { name: 'Preview revision 1' }));
  await waitFor(() => expect(host.textContent).toContain('Previewing v1'));
  expect(changed).toHaveBeenLastCalledWith(true);
  update({ expanded: false });
  expect(host.textContent).toBe('');
  expect(changed).toHaveBeenLastCalledWith(false);
  unmount();
  host.remove();
});
it('requires confirmation and sends the acknowledged revision to the existing restore endpoint', async () => {
  const api = stub();
  const { props } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Restore revision 1' }));
  expect(
    screen.getByText(
      'Replace the current text with revision 1? It becomes revision 7; nothing is deleted.',
    ),
  ).not.toBeNull();
  expect(api.mock.calls.some(([url]) => String(url).endsWith('/restore'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(
    screen.queryByRole('button', { name: 'Confirm restore of revision 1' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Restore revision 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore of revision 1' }));
  await waitFor(() =>
    expect(props.onRestored).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 7 }),
    ),
  );
  const request = api.mock.calls.find(([url]) => String(url).endsWith('/v1/restore'));
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ revision: 6 });
  expect(screen.getByRole('list', { name: 'Versions' }).children).toHaveLength(5);
});
it('disables an already-open confirmation if edits become unsaved, and hides restore from viewers', async () => {
  const api = stub();
  const { update } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Restore revision 1' }));
  update({ restoreBlockedReason: 'Restoring is available once your changes are saved.' });
  expect(
    screen.getByRole('button', { name: 'Confirm restore of revision 1' }),
  ).toHaveProperty('disabled', true);
  expect(
    screen.getByText('Restoring is available once your changes are saved.'),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore of revision 1' }));
  expect(api.mock.calls.some(([url]) => String(url).endsWith('/restore'))).toBe(false);
  update({ canRestore: false });
  expect(screen.queryByRole('button', { name: /Restore|Confirm restore/ })).toBeNull();
});
it('shows history, preview and restore failures without replacing any text', async () => {
  stub({ listError: true });
  const first = setup();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load the history: No access',
  );
  first.unmount();
  stub({ previewError: true, restoreError: true });
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview revision 1' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load this version: No access',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close version preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore revision 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore of revision 1' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not restore: No access',
  );
});
it('handles missing history and unsupported stored bodies explicitly', async () => {
  stub({ rows: [] });
  const first = setup();
  await screen.findByText('No versions yet.');
  first.unmount();
  stub({ previewContent: { type: 'unknown' } });
  const second = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview revision 1' }));
  await screen.findByText('This version contains content this editor cannot display.');
  second.unmount();
  stub();
  setup({ currentDocument: { ...current, content: { type: 'unknown' } } });
  fireEvent.click(await screen.findByRole('button', { name: 'Preview revision 1' }));
  await screen.findByText(
    'The current document contains content this editor cannot compare. Nothing has been changed.',
  );
});

it('creates a named snapshot of the acknowledged state, refreshes history and preserves names and system actors', async () => {
  const api = stub({
    rows: [
      {
        ...versions[0]!,
        id: 'named',
        reason: 'MANUAL_SNAPSHOT',
        name: 'Before review',
        actorName: 'Former member',
        stateSha256: 'hash',
        collaborationSequence: 3,
      },
      {
        ...versions[1]!,
        reason: 'SCHEDULED_SNAPSHOT',
        name: 'Automatic snapshot',
        createdBy: null,
      },
      ...versions,
    ],
  });
  setup();
  await screen.findByText('Before review');
  expect(screen.getByText('Former member', { exact: false })).not.toBeNull();
  expect(screen.getByText('System', { exact: false })).not.toBeNull();
  expect(screen.getByText('Collaborative snapshot · state 3')).not.toBeNull();
  const button = screen.getByRole('button', { name: 'Save named snapshot' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Snapshot name'), {
    target: { value: '  Before review  ' },
  });
  fireEvent.click(button);
  await screen.findByText('Named snapshot saved.');
  const request = api.mock.calls.find(([url]) => String(url).endsWith('/snapshots'));
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    revision: 6,
    name: 'Before review',
  });
  expect(screen.getByLabelText('Snapshot name')).toHaveProperty('value', '');
  expect(
    api.mock.calls.filter(([url]) => String(url).endsWith('/versions')).length,
  ).toBeGreaterThan(1);
});
it('blocks snapshots while changes are unsaved and reports server rejection without clearing the name', async () => {
  const api = stub({ snapshotError: true });
  const { update } = setup({ restoreBlockedReason: 'Wait for durable save.' });
  fireEvent.change(screen.getByLabelText('Snapshot name'), {
    target: { value: 'Review' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save named snapshot' }));
  expect(api.mock.calls.some(([url]) => String(url).endsWith('/snapshots'))).toBe(false);
  update({ restoreBlockedReason: null });
  fireEvent.click(screen.getByRole('button', { name: 'Save named snapshot' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not save snapshot: No access',
  );
  expect(screen.getByLabelText('Snapshot name')).toHaveProperty('value', 'Review');
  update({ canRestore: false });
  expect(screen.queryByLabelText('Snapshot name')).toBeNull();
});
