import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { SourceBibliography } from './sourceApi';

export type BibliographyFormat = 'BIBTEX' | 'RIS' | 'CSL_JSON';
export type BibliographyOrigin = 'GENERIC' | 'ZOTERO' | 'MENDELEY';
export type BibliographyRecordStatus = 'READY' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';
export type BibliographyMatchKind = 'SOURCE' | 'BIBLIOGRAPHIC_ITEM';

export interface BibliographyMatch {
  readonly kind: BibliographyMatchKind;
  readonly id: string;
  readonly title: string;
  readonly reason: 'DOI' | 'METADATA';
  readonly conflictingFields: readonly string[];
  readonly existingBibliography?: SourceBibliography;
  readonly tags?: readonly string[];
  readonly collections?: readonly string[];
}
export interface BibliographyPreviewRecord {
  readonly recordNumber: number;
  readonly location: string;
  readonly status: BibliographyRecordStatus;
  readonly itemType: string | null;
  readonly bibliography: SourceBibliography | null;
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly ignoredAttachments: number;
  readonly issues: readonly string[];
  readonly matches: readonly BibliographyMatch[];
}
export interface BibliographyPreview {
  readonly id: string;
  readonly workspaceId: string;
  readonly fileName: string;
  readonly fileSha256: string;
  readonly format: BibliographyFormat;
  readonly origin: BibliographyOrigin;
  readonly status: 'PREVIEWED' | 'CONFIRMED' | 'CANCELLED';
  readonly totalRecords: number;
  readonly ready: number;
  readonly duplicates: number;
  readonly conflicts: number;
  readonly rejected: number;
  readonly records: readonly BibliographyPreviewRecord[];
  readonly createdAt: string;
}
export type BibliographyConfirmAction =
  'CREATE' | 'LINK_SOURCE' | 'REPLACE_SOURCE' | 'REPLACE_ITEM' | 'SKIP';
export interface BibliographyDecision {
  readonly recordNumber: number;
  readonly action: BibliographyConfirmAction;
  readonly targetId?: string;
  readonly acceptedBibliography?: SourceBibliography;
  readonly mergeOrganization?: boolean;
}
export interface BibliographyImportResult {
  readonly importId: string;
  readonly created: number;
  readonly linked: number;
  readonly updated: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly duplicates: number;
  readonly confirmedAt: string;
}

const path = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/bibliography/imports`;

export async function previewBibliographyImport(
  workspaceId: string,
  file: File,
  origin: BibliographyOrigin,
): Promise<BibliographyPreview> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  const body = new FormData();
  body.append('file', file, file.name);
  return apiClient.post(`${path(workspaceId)}?origin=${encodeURIComponent(origin)}`, {
    formData: body,
  });
}

export async function confirmBibliographyImport(
  workspaceId: string,
  importId: string,
  decisions: readonly BibliographyDecision[],
): Promise<BibliographyImportResult> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(`${path(workspaceId)}/${encodeURIComponent(importId)}/confirm`, {
    body: { decisions },
  });
}

export async function cancelBibliographyImport(
  workspaceId: string,
  importId: string,
): Promise<void> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.delete(`${path(workspaceId)}/${encodeURIComponent(importId)}`);
}

export function fetchBibliographyImportResult(
  workspaceId: string,
  importId: string,
): Promise<BibliographyImportResult> {
  return apiClient.get(`${path(workspaceId)}/${encodeURIComponent(importId)}/result`);
}
export interface BibliographyItem {
  readonly id: string;
  readonly sourceId: string | null;
  readonly itemType: string;
  readonly bibliography: SourceBibliography;
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly updatedAt: string;
}
export interface BibliographyItemPage {
  readonly items: readonly BibliographyItem[];
  readonly nextOffset: number;
}
export function fetchBibliographyItems(
  workspaceId: string,
  offset: number,
  signal?: AbortSignal,
): Promise<BibliographyItemPage> {
  return apiClient.get(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/bibliography/items?offset=${String(offset)}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
export async function saveBibliographyItem(
  workspaceId: string,
  item: BibliographyItem,
): Promise<void> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.put(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/bibliography/items/${encodeURIComponent(item.id)}`,
    {
      body: {
        bibliography: item.bibliography,
        tags: item.tags,
        collections: item.collections,
        expectedUpdatedAt: item.updatedAt,
      },
    },
  );
}
