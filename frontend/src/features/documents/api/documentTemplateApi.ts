import { apiClient } from '../../../shared/api';
import type { Locale } from '../../../shared/i18n';
import type { ProseMirrorDocument } from './documentContent';
import type { WorkspaceDocument } from './documentApi';

export interface DocumentTemplate {
  readonly id: string;
  readonly version: number;
  readonly locale: Locale;
  readonly title: string;
  readonly description: string;
  readonly requiredPlaceholders: readonly {
    readonly id: string;
    readonly hint: string;
  }[];
  readonly content: ProseMirrorDocument;
  readonly sha256: string;
}
export interface TemplateCreation {
  readonly clientRequestId: string;
  readonly templateId: string;
  readonly version: number;
  readonly locale: Locale;
  readonly title: string;
}
export interface DocumentTemplateOrigin {
  readonly documentId: string;
  readonly templateId: string;
  readonly version: number;
  readonly locale: Locale;
  readonly templateSha256: string;
  readonly initialContentSha256: string;
  readonly createdAt: string;
}
export function fetchDocumentTemplates(
  workspaceId: string,
  locale: Locale,
  signal?: AbortSignal,
): Promise<readonly DocumentTemplate[]> {
  return apiClient.get(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/document-templates?locale=${locale}`,
    { signal },
  );
}
export function createDocumentFromTemplate(
  workspaceId: string,
  input: TemplateCreation,
): Promise<WorkspaceDocument> {
  return apiClient.post(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/from-template`,
    { body: input },
  );
}
