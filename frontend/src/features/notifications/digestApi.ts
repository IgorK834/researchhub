import { apiClient, CSRF_PRIMING_PATH } from '../../shared/api';
import type { NotificationType } from './notificationApi';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MUTED';
export interface DigestSettings {
  frequency: Frequency;
  mutedCategories: NotificationType[];
}
export interface DigestPreference {
  workspaceId: string;
  settings: DigestSettings;
  sessionLocal: boolean;
}
export interface DigestItem {
  workspaceId: string;
  category: NotificationType;
  count: number;
  href: string;
}
export interface DigestFeed {
  since: string;
  through: string;
  sinceLastSeen: DigestItem[];
  truncated: boolean;
  digests: {
    id: string;
    windowStart: string;
    windowEnd: string;
    frequency: Frequency;
    items: DigestItem[];
  }[];
}
export const digestApi = {
  feed: (): Promise<DigestFeed> => apiClient.get('/api/notifications/digests'),
  preferences: (): Promise<DigestPreference[]> =>
    apiClient.get('/api/notifications/digests/preferences'),
  save: async (workspace: string, settings: DigestSettings): Promise<void> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.put(
      `/api/notifications/digests/preferences/${encodeURIComponent(workspace)}`,
      { body: settings },
    );
  },
  seen: async (through: string): Promise<void> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post('/api/notifications/digests/seen', { body: { through } });
  },
};
