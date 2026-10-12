import { apiClient } from '../../../shared/api';

export interface AiUsageSummary {
  readonly from: string;
  readonly to: string;
  readonly features: readonly {
    feature: string;
    requests: number;
    failures: number;
    usageKnown: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }[];
  readonly quotas: readonly {
    category: string;
    requests: number;
    limit: number;
    resetsAt: string;
  }[];
}
export const fetchAiUsage = (
  workspaceId: string,
  days: number,
  signal?: AbortSignal,
): Promise<AiUsageSummary> =>
  apiClient.get(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/ai/usage?days=${days}`,
    { signal },
  );

export async function downloadAudit(
  workspaceId: string,
  format: 'csv' | 'json',
): Promise<void> {
  const blob = await apiClient.getBlob(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/audit/export?format=${format}`,
    { accept: format === 'csv' ? 'text/csv' : 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${workspaceId}.${format}`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
