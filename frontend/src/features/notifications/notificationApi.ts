import { apiClient, CSRF_PRIMING_PATH } from '../../shared/api';
export const notificationTypes = [
  'COMMENT',
  'MENTION',
  'ANALYSIS_COMPLETED',
  'ANALYSIS_FAILED',
  'REVIEW_TASK',
  'ATTENTION',
  'ANALYSIS_STALE',
] as const;
export type NotificationType = (typeof notificationTypes)[number];
export interface ProductNotification {
  readonly workspaceLabel?: string;
  readonly targetLabel?: string | null;
  readonly id: string;
  readonly eventId: string;
  readonly workspaceId: string;
  readonly type: NotificationType;
  readonly targetType: string;
  readonly targetId: string;
  readonly documentId: string | null;
  readonly href: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}
export interface NotificationPage {
  readonly items: readonly ProductNotification[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
  readonly countCapped: boolean;
}
export interface Preference {
  readonly type: NotificationType;
  readonly muted: boolean;
}
export const notificationApi = {
  list: (
    cursor: string | null,
    unread: boolean,
    type: NotificationType | '',
    limit = 20,
  ): Promise<NotificationPage> => {
    const query = new URLSearchParams({ limit: String(limit), unread: String(unread) });
    if (cursor) query.set('cursor', cursor);
    if (type) query.set('type', type);
    return apiClient.get(`/api/notifications?${query}`);
  },
  read: async (id: string): Promise<void> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(`/api/notifications/${encodeURIComponent(id)}/read`);
  },
  readAll: async (before: string): Promise<{ updated: number }> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post('/api/notifications/read-all', {
      body: { before, limit: 100 },
    });
  },
  preferences: (workspace: string): Promise<Preference[]> =>
    apiClient.get(`/api/notifications/preferences/${encodeURIComponent(workspace)}`),
  mute: async (
    workspace: string,
    type: NotificationType,
    muted: boolean,
  ): Promise<void> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.put(
      `/api/notifications/preferences/${encodeURIComponent(workspace)}`,
      { body: { type, muted } },
    );
  },
};
