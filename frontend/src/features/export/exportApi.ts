import { t as uiText } from '../../shared/i18n';
import { apiClient } from '../../shared/api';
import type { Locale } from '../../shared/i18n';

export type ExportFormat = 'DOCX' | 'PDF' | 'LATEX';
export type CitationStyle = 'APA_7' | 'IEEE';
export const citationStyleLabels: Readonly<Record<CitationStyle, string>> = {
  get APA_7() {
    return uiText('citation.apa');
  },
  IEEE: 'IEEE',
};
export const exportFormatLabels: Readonly<Record<ExportFormat, string>> = {
  DOCX: 'DOCX',
  PDF: 'PDF',
  LATEX: 'LaTeX',
};
const mediaTypes: Readonly<Record<ExportFormat, string>> = {
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PDF: 'application/pdf',
  LATEX: 'application/zip',
};
export interface ExportJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly revision: number;
  readonly format: ExportFormat;
  readonly citationStyle: CitationStyle;
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
  citationStyle: CitationStyle,
  revision: number,
  exportLanguage: Locale = 'en',
): Promise<ExportJob> {
  return apiClient.post(path(workspace, document), {
    body: { format, citationStyle, revision, exportLanguage },
  });
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
      accept: mediaTypes[job.format],
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
      return uiText('ui.exportApi.message001');
    case 'OUTPUT_TOO_LARGE':
      return uiText('ui.exportApi.message002');
    case 'RENDER_INTERRUPTED':
      return uiText('ui.exportApi.message003');
    default:
      return uiText('ui.exportApi.message004');
  }
}
