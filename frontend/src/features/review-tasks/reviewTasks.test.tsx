/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReviewTasks } from './ReviewTasks';
import { TaskComposer, CreateReviewTaskButton } from './TaskComposer';
import { EvidenceReviewTarget } from './EvidenceReviewTarget';
import { reviewTaskApi, transitions, type ReviewTask } from './reviewTaskApi';
import { memberApi } from '../comments/memberApi';
import { useDocumentsQuery } from '../documents/api/useDocuments';
import { useAnalysesQuery } from '../analysis/api/useAnalyses';
import { apiClient } from '../../shared/api';
import { setLocale } from '../../shared/i18n';
jest.mock('./reviewTaskApi', () => ({
  ...jest.requireActual('./reviewTaskApi'),
  reviewTaskApi: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../comments/memberApi', () => ({ memberApi: { search: jest.fn() } }));
jest.mock('../documents/api/useDocuments', () => ({ useDocumentsQuery: jest.fn() }));
jest.mock('../analysis/api/useAnalyses', () => ({ useAnalysesQuery: jest.fn() }));
jest.mock('../ai/components/SourceComparisonPanel', () => ({
  DisagreementResult: () => <p>Evidence finding</p>,
}));
jest.mock('../../shared/api', () => ({
  ...jest.requireActual('../../shared/api'),
  apiClient: { get: jest.fn() },
}));
const date = '2026-10-14T10:00:00Z';
const task: ReviewTask = {
  id: 't',
  workspaceId: 'w',
  title: '<Review>',
  description: 'Description',
  targetType: 'DOCUMENT',
  targetId: 'd',
  assignee: 'member',
  assigneeLabel: 'Member',
  unassignedReason: null,
  status: 'OPEN',
  dueAt: date,
  revision: 2,
  createdBy: 'owner',
  createdAt: date,
  updatedAt: date,
  href: '/app/workspaces/w/documents/d',
};
let client: QueryClient;
function wrap(child: React.ReactNode, route = '/') {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{child}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  setLocale('en');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.mocked(reviewTaskApi.list).mockResolvedValue({ items: [task], nextCursor: null });
  jest.mocked(reviewTaskApi.get).mockResolvedValue(task);
  jest.mocked(reviewTaskApi.create).mockResolvedValue(task);
  jest.mocked(reviewTaskApi.update).mockResolvedValue(task);
  jest
    .mocked(memberApi.search)
    .mockResolvedValue([{ userId: 'member', displayLabel: 'Member' }]);
  jest.mocked(useDocumentsQuery).mockReturnValue({
    data: [{ id: 'd', title: 'Document' }],
    isPending: false,
    error: null,
  } as never);
  jest.mocked(useAnalysesQuery).mockReturnValue({
    data: [{ id: 'a', createdAt: date }],
    isPending: false,
    error: null,
  } as never);
  jest.mocked(apiClient.get).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});
it('lists Mine/Open/Overdue, pages, renders plain titles and completes using the revision', async () => {
  jest.mocked(reviewTaskApi.list).mockImplementation(async (_w, _f, cursor) => ({
    items: [{ ...task, id: cursor ? 'older' : 't' }],
    nextCursor: cursor ? null : 'cursor',
  }));
  wrap(<ReviewTasks workspaceId="w" canEdit />);
  await screen.findByText('<Review>');
  expect(document.querySelector('review')).toBeNull();
  for (const [label, filter] of [
    ['Mine', 'MINE'],
    ['Open', 'OPEN'],
    ['Overdue', 'OVERDUE'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(reviewTaskApi.list).toHaveBeenCalledWith('w', filter, null),
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(screen.getAllByText('<Review>')).toHaveLength(2));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Newest' }).hasAttribute('disabled')).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Newest' }));
  await waitFor(() => expect(screen.getAllByText('<Review>')).toHaveLength(1));
  fireEvent.click(screen.getAllByRole('button', { name: 'Complete' })[0]!);
  await waitFor(() =>
    expect(reviewTaskApi.update).toHaveBeenCalledWith('w', task, task, 'DONE'),
  );
});
it('opens and closes inline assignment editing, shows removed assignee and terminal tasks', async () => {
  jest.mocked(reviewTaskApi.list).mockResolvedValue({
    items: [
      {
        ...task,
        status: 'DONE',
        assignee: null,
        unassignedReason: 'MEMBER_REMOVED',
        dueAt: null,
      },
    ],
    nextCursor: null,
  });
  wrap(<ReviewTasks workspaceId="w" canEdit />);
  await screen.findByText(/Unassigned — member removed/);
  expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit / assign' }));
  expect(screen.getByLabelText('Task title')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit / assign' }));
  expect(screen.queryByLabelText('Task title')).toBeNull();
});
it('loads a deep linked task outside the first page and respects read-only access', async () => {
  jest.mocked(reviewTaskApi.list).mockResolvedValue({ items: [], nextCursor: null });
  wrap(<ReviewTasks workspaceId="w" canEdit={false} />, '/?task=t');
  await screen.findByText('<Review>');
  expect(reviewTaskApi.get).toHaveBeenCalledWith('w', 't');
  expect(screen.queryByRole('button', { name: 'Edit / assign' })).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Open review target' }).getAttribute('href'),
  ).toBe(task.href);
});
it('shows loading, empty, failure, retry and hides revoked cached rows', async () => {
  jest.mocked(reviewTaskApi.list).mockResolvedValue({ items: [], nextCursor: null });
  wrap(<ReviewTasks workspaceId="w" canEdit={false} />);
  await screen.findByText('No review tasks.');
  jest.mocked(reviewTaskApi.list).mockRejectedValue(new Error('revoked'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['review-tasks', 'w'] });
  });
  await screen.findByRole('alert');
  jest.mocked(reviewTaskApi.list).mockResolvedValue({ items: [task], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('<Review>');
});
it('surfaces completion failure and lets users select document and analysis targets', async () => {
  jest.mocked(reviewTaskApi.update).mockRejectedValue(new Error('Conflict'));
  wrap(<ReviewTasks workspaceId="w" canEdit />);
  await screen.findByText('<Review>');
  fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Review target'), { target: { value: 'd' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request review' }));
  await screen.findByRole('dialog');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.change(screen.getByLabelText('Review target type'), {
    target: { value: 'ANALYSIS' },
  });
  fireEvent.change(screen.getByLabelText('Review target'), { target: { value: 'a' } });
  expect(screen.getByRole('button', { name: 'Request review' })).toBeTruthy();
});
it('handles unavailable target lists and target loading', async () => {
  jest.mocked(useDocumentsQuery).mockReturnValue({
    error: new Error('documents unavailable'),
    isPending: true,
  } as never);
  wrap(<ReviewTasks workspaceId="w" canEdit />);
  await screen.findByRole('alert');
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Request review' })).toBeNull();
});
it('creates with an idempotency id, typed assignee and UTC date', async () => {
  const saved = jest.fn();
  wrap(
    <TaskComposer
      workspaceId="w"
      target={{ targetType: 'COMMENT', targetId: 'c', documentId: 'd' }}
      onSaved={saved}
    />,
  );
  fireEvent.change(screen.getByLabelText('Task title'), {
    target: { value: '  Check result  ' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Review this' },
  });
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: 'Member' }));
  fireEvent.change(screen.getByLabelText('Due date (your local time)'), {
    target: { value: '2026-11-01T10:30' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create review task' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(reviewTaskApi.create).toHaveBeenCalledWith(
    'w',
    expect.any(String),
    { targetType: 'COMMENT', targetId: 'c', documentId: 'd' },
    {
      title: 'Check result',
      description: 'Review this',
      assignee: 'member',
      dueAt: new Date('2026-11-01T10:30').toISOString(),
    },
  );
});
it('edits, unassigns, clears a due date and reports concurrency errors', async () => {
  jest.mocked(reviewTaskApi.update).mockRejectedValue(new Error('Conflict'));
  const saved = jest.fn();
  wrap(<TaskComposer workspaceId="w" target={task} task={task} onSaved={saved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove assignment' }));
  fireEvent.change(screen.getByLabelText('Due date (your local time)'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(reviewTaskApi.update).toHaveBeenCalledWith(
    'w',
    task,
    { title: '<Review>', description: 'Description', assignee: null, dueAt: null },
    'IN_PROGRESS',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload tasks' }));
  expect(saved).not.toHaveBeenCalled();
});
it('retries an unchanged create with the same UUID and changes it for a changed draft', async () => {
  jest.mocked(reviewTaskApi.create).mockRejectedValue(new Error('Lost response'));
  wrap(
    <TaskComposer
      workspaceId="w"
      target={{ targetType: 'DOCUMENT', targetId: 'd' }}
      onSaved={jest.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Review' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create review task' }));
  await screen.findByRole('alert');
  const id = jest.mocked(reviewTaskApi.create).mock.calls[0]![1];
  fireEvent.click(screen.getByRole('button', { name: 'Create review task' }));
  await waitFor(() => expect(reviewTaskApi.create).toHaveBeenCalledTimes(2));
  expect(jest.mocked(reviewTaskApi.create).mock.calls[1]![1]).toBe(id);
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create review task' }));
  await waitFor(() => expect(reviewTaskApi.create).toHaveBeenCalledTimes(3));
  expect(jest.mocked(reviewTaskApi.create).mock.calls[2]![1]).not.toBe(id);
});
it('opens request-review modal, saves and restores focus', async () => {
  wrap(
    <CreateReviewTaskButton
      workspaceId="w"
      target={{ targetType: 'DOCUMENT', targetId: 'd' }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Request review' }));
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Review' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create review task' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Request review' }),
  );
});
it('loads a protected evidence target, handles errors and no target', async () => {
  wrap(<EvidenceReviewTarget workspaceId="w" />, '/?evidenceAnalysis=a&finding=0');
  await screen.findByText('Evidence finding');
  expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/w/ai/source-analyses/a');
  jest.mocked(apiClient.get).mockRejectedValue(new Error('revoked'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['evidence-review-target'] });
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Evidence finding')).toBeNull();
});
it('does not fetch evidence for ordinary pages', () => {
  wrap(<EvidenceReviewTarget workspaceId="w" />);
  expect(apiClient.get).not.toHaveBeenCalled();
});
it('only offers explicit allowed transitions', () => {
  expect(transitions('OPEN')).toContain('DONE');
  expect(transitions('IN_PROGRESS')).toContain('OPEN');
  expect(transitions('DONE')).toEqual(['DONE', 'OPEN']);
  expect(transitions('CANCELLED')).toEqual(['CANCELLED', 'OPEN']);
});
