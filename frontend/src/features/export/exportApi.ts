import { apiClient } from '../../shared/api';

export type ExportFormat = 'DOCX' | 'PDF';
export interface ExportJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly revision: number;
  readonly format: ExportFormat;
  readonly status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  readonly filename: string;
  readonly warnings: readonly string[];
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly expiresAt: string;
  readonly failureCode: string | null;
  readonly sha256: string | null;
  readonly sizeBytes: number;
}
const path = (workspace: string, document: string): string =>
  `/api/workspaces/${encodeURIComponent(workspace)}/documents/${encodeURIComponent(document)}/exports`;
export function createExport(
  workspace: string,
  document: string,
  format: ExportFormat,
  revision: number,
): Promise<ExportJob> {
  return apiClient.post(path(workspace, document), { body: { format, revision } });
}
export function fetchExport(
  workspace: string,
  document: string,
  job: string,
  signal?: AbortSignal,
): Promise<ExportJob> {
  return apiClient.get(`${path(workspace, document)}/${encodeURIComponent(job)}`, {
    signal,
  });
}
export async function downloadExport(job: ExportJob): Promise<void> {
  const blob = await apiClient.getBlob(
    `${path(job.workspaceId, job.documentId)}/${encodeURIComponent(job.id)}/download`,
    {
      accept:
        job.format === 'PDF'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = job.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A later task gives browsers time to start consuming the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportFailure(code: string | null): string {
  switch (code) {
    case 'ACCESS_REVOKED':
      return 'Workspace access changed. Check your access before exporting again.';
    case 'OUTPUT_TOO_LARGE':
      return 'The report is too large. Export a smaller document.';
    case 'RENDER_INTERRUPTED':
      return 'Rendering was interrupted. Generate the export again.';
    default:
      return 'The report could not be rendered. Generate the export again.';
  }
}
