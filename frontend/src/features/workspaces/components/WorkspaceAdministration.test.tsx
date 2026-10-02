/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useWorkspaceQuery } from '../api/useWorkspaces';
import { AddMemberForm } from './AddMemberForm';
import { MemberList } from './MemberList';
import { EditWorkspaceForm } from './EditWorkspaceForm';
import { ArchiveWorkspaceButton } from './ArchiveWorkspaceButton';
import type { ReactNode } from 'react';
import { installResizeObserver } from '../../../shared/testing/resizeObserver';

const timestamp = '2026-10-02T10:00:00Z';
const workspace = {
  id: 'w1',
  name: 'Lab',
  description: 'Existing description',
  role: 'OWNER',
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const owner = {
  userId: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'OWNER',
};
const editor = {
  userId: 'kasia',
  displayName: 'Kasia Nowak',
  email: 'kasia@example.com',
  role: 'EDITOR',
};
const originalFetch = globalThis.fetch;
let restoreResizeObserver: () => void;
beforeEach(() => {
  restoreResizeObserver = installResizeObserver();
});
function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: {
      get: () => (status >= 400 ? 'application/problem+json' : 'application/json'),
    },
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
  } as unknown as Response;
}
function problem(
  detail: string,
  errors?: { field: string; message: string }[],
): Response {
  return json(
    {
      type: 'about:blank',
      status: errors ? 400 : 409,
      code: errors ? 'VALIDATION_FAILED' : 'CONFLICT',
      title: 'Failed',
      detail,
      errors,
    },
    errors ? 400 : 409,
  );
}
function fixture(
  options: {
    members?: (typeof owner)[];
    read?: Response | Promise<Response>;
    mutation?: Response | Promise<Response>;
  } = {},
) {
  let current = workspace;
  let members = options.members ?? [owner, editor];
  const mock = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url),
      method = init?.method ?? 'GET';
    if (path.endsWith('/csrf')) return Promise.resolve(json(null, 204));
    if (method !== 'GET') {
      if (options.mutation !== undefined) return Promise.resolve(options.mutation);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, string>)
        : {};
      if (method === 'PATCH' && path.includes('/members/')) {
        members = members.map((member) =>
          member.userId === path.split('/').at(-1)
            ? { ...member, role: body.role! }
            : member,
        );
        return Promise.resolve(json(members[1]));
      }
      if (method === 'DELETE') {
        members = members.filter((member) => member.userId !== path.split('/').at(-1));
        return Promise.resolve(json(null, 204));
      }
      if (path.endsWith('/members')) {
        const added = { ...editor, email: body.email!, role: body.role! };
        members = [...members, added];
        return Promise.resolve(json(added, 201));
      }
      if (method === 'PATCH') {
        current = {
          ...current,
          name: body.name!.trim(),
          description: body.description!.trim(),
        };
        return Promise.resolve(json(current));
      }
      return Promise.resolve(json({ ...current, archivedAt: timestamp }));
    }
    if (path.endsWith('/members')) return Promise.resolve(options.read ?? json(members));
    if (path === '/api/workspaces/w1') return Promise.resolve(json(current));
    if (path === '/api/workspaces') return Promise.resolve(json([current]));
    throw new Error('Unexpected request: ' + path);
  });
  globalThis.fetch = mock;
  return mock;
}
function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function Settings() {
  const { data } = useWorkspaceQuery('w1');
  return data ? <EditWorkspaceForm workspace={data} /> : null;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreResizeObserver();
});

it('changes Editor, Viewer and Owner roles through keyboard menus and refetched badges', async () => {
  const mock = fixture({ members: [owner, { ...editor, role: 'REVIEWER' }] });
  mount(<MemberList workspaceId="w1" canManage />);
  const table = await screen.findByRole('table', { name: 'Members' });
  expect(within(table).getByText('REVIEWER')).toBeTruthy();
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Member', 'Role', 'Actions']);
  for (const [name, role] of [
    ['Editor', 'EDITOR'],
    ['Viewer', 'VIEWER'],
    ['Make owner', 'OWNER'],
  ]) {
    const trigger = within(table).getByRole('button', { name: 'Role for Kasia Nowak' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'Role for Kasia Nowak' });
    fireEvent.click(within(menu).getByRole('menuitem', { name }));
    await waitFor(() =>
      expect(
        mock.mock.calls.filter((call) => call[1]?.method === 'PATCH').at(-1)?.[1]?.body,
      ).toBe(JSON.stringify({ role })),
    );
    await waitFor(() =>
      expect(within(table).getAllByRole('row').at(-1)?.textContent).toContain(
        role === 'OWNER' ? 'Owner' : name,
      ),
    );
  }
});
it('confirms removal with neutral copy, returns focus on Keep and Esc, and preserves last-owner errors', async () => {
  const mock = fixture({
    mutation: problem('A workspace must always have at least one owner.'),
  });
  mount(<MemberList workspaceId="w1" canManage />);
  const trigger = await screen.findByRole('button', { name: 'Remove Ada Lovelace' });
  fireEvent.click(trigger);
  const modal = screen.getByRole('dialog', { name: 'Remove Ada Lovelace?' });
  expect(within(modal).getByRole('button', { name: 'Keep' })).toBe(
    document.activeElement,
  );
  expect(modal.textContent).toContain('This person will lose access');
  expect(modal.textContent).toContain('Their edits and contributions will stay.');
  expect(mock.mock.calls.filter((call) => call[1]?.method === 'DELETE')).toHaveLength(0);
  fireEvent.click(within(modal).getByRole('button', { name: 'Keep' }));
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove member' }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('at least one owner');
  expect(screen.getByRole('table').textContent).toContain('ada@example.com');
});
it('shows member loading and roster errors without management rows', async () => {
  let complete!: (value: Response) => void;
  fixture({
    read: new Promise((resolve) => {
      complete = resolve;
    }),
  });
  mount(<MemberList workspaceId="w1" canManage={false} />);
  expect(screen.getByText('Loading members…')).toBeTruthy();
  await act(async () => {
    complete(problem('Access is unavailable.'));
  });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load the members',
  );
  expect(screen.queryByRole('table')).toBeNull();
});
it('selects Viewer with arrow keys, adds by email and clears the successful draft', async () => {
  const mock = fixture({ members: [owner] });
  mount(<AddMemberForm workspaceId="w1" />);
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'kasia@example.com' },
  });
  const editorChoice = screen.getByRole('radio', { name: 'Editor' });
  editorChoice.focus();
  fireEvent.keyDown(editorChoice, { key: 'ArrowRight' });
  expect(screen.getByRole('radio', { name: 'Viewer' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
  await waitFor(() => expect(screen.getByLabelText('Email')).toHaveProperty('value', ''));
  const post = mock.mock.calls.find((call) => call[1]?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    email: 'kasia@example.com',
    role: 'VIEWER',
  });
  expect(screen.queryByText(/invitation|send.*email|Joined|Resend/i)).toBeNull();
});
it('associates server email and role validation with the fields and blocks duplicate member submission', async () => {
  let complete!: (value: Response) => void;
  const mock = fixture({
    mutation: new Promise((resolve) => {
      complete = resolve;
    }),
  });
  mount(<AddMemberForm workspaceId="w1" />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });
  const form = screen.getByLabelText('Email').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Adding…' })).toHaveProperty(
      'disabled',
      true,
    ),
  );
  fireEvent.submit(form);
  await act(async () => {
    complete(
      problem('Validation failed', [
        { field: 'email', message: 'Enter a valid email.' },
        { field: 'role', message: 'Role is not available.' },
      ]),
    );
  });
  expect(await screen.findByText('Enter a valid email.')).toBeTruthy();
  expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(
    'add-member-email-error',
  );
  expect(
    screen.getByRole('radiogroup', { name: 'Role' }).getAttribute('aria-describedby'),
  ).toBe('add-member-role-error');
  expect(mock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
});
it('discards drafts, saves normalized metadata and restores the last saved values', async () => {
  fixture();
  mount(<Settings />);
  const name = await screen.findByLabelText('Name');
  fireEvent.change(name, { target: { value: 'Unsaved' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Unsaved description' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(name).toHaveProperty('value', 'Lab');
  expect(screen.getByLabelText('Description')).toHaveProperty(
    'value',
    workspace.description,
  );
  fireEvent.change(name, { target: { value: '  New lab  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved.')).toBeTruthy();
  expect(name).toHaveProperty('value', 'New lab');
  fireEvent.change(name, { target: { value: 'Another draft' } });
  expect(screen.queryByText('Changes saved.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(name).toHaveProperty('value', 'New lab');
});
it('keeps settings pending, prevents duplicate save and clears a general failure on Discard', async () => {
  let complete!: (value: Response) => void;
  const mock = fixture({
    mutation: new Promise((resolve) => {
      complete = resolve;
    }),
  });
  mount(<EditWorkspaceForm workspace={workspace} />);
  const form = screen.getByLabelText('Name').closest('form')!;
  fireEvent.submit(form);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty(
      'disabled',
      true,
    ),
  );
  expect(screen.getByLabelText('Name')).toHaveProperty('disabled', true);
  fireEvent.submit(form);
  await act(async () => {
    complete(problem('Your role cannot rename this workspace.'));
  });
  expect((await screen.findByRole('alert')).textContent).toContain('cannot rename');
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(mock.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(1);
});
it('renders read-only General metadata without inputs or archive promises', () => {
  fixture();
  mount(
    <EditWorkspaceForm
      workspace={{ ...workspace, role: 'EDITOR', description: null }}
      readOnly
    />,
  );
  expect(screen.getByText('No description.')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
it('uses a safe initial focus for archive, returns focus on cancel and preserves server errors', async () => {
  fixture({ mutation: problem('This workspace cannot be archived.') });
  mount(<ArchiveWorkspaceButton workspaceId="w1" workspaceName="Lab" />);
  const trigger = screen.getByRole('button', { name: 'Archive workspace' });
  fireEvent.click(trigger);
  let modal = screen.getByRole('dialog', { name: 'Archive Lab?' });
  expect(document.activeElement).toBe(
    within(modal).getByRole('button', { name: 'Cancel' }),
  );
  expect(modal.textContent).toContain('No files or documents will be deleted.');
  expect(modal.textContent).not.toMatch(/restore/i);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  modal = screen.getByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: 'Archive workspace' }));
  expect((await screen.findByRole('alert')).textContent).toContain('cannot be archived');
  fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(trigger);
});
it('keeps archive confirmation open while pending and disables dismissal', async () => {
  let complete!: (value: Response) => void;
  fixture({
    mutation: new Promise((resolve) => {
      complete = resolve;
    }),
  });
  mount(<ArchiveWorkspaceButton workspaceId="w1" workspaceName="Lab" />);
  fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
  const modal = screen.getByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: 'Archive workspace' }));
  await waitFor(() =>
    expect(within(modal).getByRole('button', { name: 'Archiving…' })).toHaveProperty(
      'disabled',
      true,
    ),
  );
  expect(within(modal).getByRole('button', { name: 'Close' })).toHaveProperty(
    'disabled',
    true,
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBe(modal);
  await act(async () => {
    complete(problem('Already archived by another owner.'));
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Already archived');
});
