import { apiClient, CSRF_PRIMING_PATH } from '../../shared/api';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskFilter = 'ALL' | 'MINE' | 'OPEN' | 'OVERDUE';
export interface ReviewTarget {
  readonly targetType: 'COMMENT' | 'DOCUMENT' | 'ANALYSIS' | 'EVIDENCE_FINDING';
  readonly targetId: string;
  readonly documentId?: string | null;
  readonly findingIndex?: number | null;
}
export interface TaskInput {
  readonly title: string;
  readonly description: string;
  readonly assignee: string | null;
  readonly dueAt: string | null;
}
export interface ReviewTask extends ReviewTarget, TaskInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly assigneeLabel: string | null;
  readonly unassignedReason: string | null;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly href: string;
}
export interface TaskPage {
  readonly items: readonly ReviewTask[];
  readonly nextCursor: string | null;
}
const path = (workspace: string): string =>
  `/api/workspaces/${encodeURIComponent(workspace)}/review-tasks`;
export const reviewTaskApi = {
  list: (
    workspace: string,
    filter: TaskFilter,
    cursor: string | null,
  ): Promise<TaskPage> => {
    const query = new URLSearchParams({ filter, limit: '20' });
    if (cursor) query.set('cursor', cursor);
    return apiClient.get(`${path(workspace)}?${query}`);
  },
  get: (workspace: string, id: string): Promise<ReviewTask> =>
    apiClient.get(`${path(workspace)}/${encodeURIComponent(id)}`),
  create: async (
    workspace: string,
    id: string,
    target: ReviewTarget,
    input: TaskInput,
  ): Promise<ReviewTask> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(path(workspace), { body: { id, ...target, ...input } });
  },
  update: async (
    workspace: string,
    task: ReviewTask,
    input: TaskInput,
    status: TaskStatus,
  ): Promise<ReviewTask> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.patch(`${path(workspace)}/${encodeURIComponent(task.id)}`, {
      body: { revision: task.revision, ...input, status },
    });
  },
};
export function transitions(status: TaskStatus): TaskStatus[] {
  if (status === 'OPEN') return ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
  if (status === 'IN_PROGRESS') return ['IN_PROGRESS', 'OPEN', 'DONE', 'CANCELLED'];
  return [status, 'OPEN'];
}
