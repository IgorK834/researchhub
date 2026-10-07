import { apiClient, CSRF_PRIMING_PATH, resolveApiUrl } from '../../../shared/api';

import type { SourceStatus, SourceType } from './sourceTypes';

function sourcesPath(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/sources`;
}

/** Public source metadata. Storage keys are intentionally absent. */
export interface WorkspaceSource {
  readonly id: string;
  readonly workspaceId: string;
  readonly originalFilename: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sourceType: SourceType;
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly status: SourceStatus;
  readonly failureSummary: string | null;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeVersionId: string;
  readonly activeVersionNumber: number;
  readonly bibliography: SourceBibliography;
  readonly tags: readonly string[];
  readonly collections: readonly string[];
}

export interface SourceVersion {
  readonly id: string;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly versionNumber: number;
  readonly originalFilename: string;
  readonly mediaType: string;
  readonly sourceType: SourceType;
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly status: SourceStatus;
  readonly failureSummary: string | null;
  readonly uploadedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly active: boolean;
}

export function fetchSources(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<readonly WorkspaceSource[]> {
  return apiClient.get<readonly WorkspaceSource[]>(sourcesPath(workspaceId), {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** One source's metadata, scoped to the workspace by the server. */
export function fetchSource(
  workspaceId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceSource> {
  return apiClient.get<WorkspaceSource>(`${sourcesPath(workspaceId)}/${sourceId}`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** Uploads one immutable source. Requires EDIT_CONTENT on the server. */
export async function uploadSource(
  workspaceId: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<WorkspaceSource> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  const formData = new FormData();
  formData.append('file', file, file.name);
  return apiClient.post<WorkspaceSource>(sourcesPath(workspaceId), {
    formData,
    ...(onProgress === undefined ? {} : { onUploadProgress: onProgress }),
  });
}

/** Replaces the active bytes while retaining every previous immutable version. */
export async function replaceSource(
  workspaceId: string,
  sourceId: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<WorkspaceSource> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  const formData = new FormData();
  formData.append('file', file, file.name);
  return apiClient.post<WorkspaceSource>(
    `${sourcesPath(workspaceId)}/${sourceId}/versions`,
    { formData, ...(onProgress === undefined ? {} : { onUploadProgress: onProgress }) },
  );
}

export function fetchSourceVersions(
  workspaceId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<readonly SourceVersion[]> {
  return apiClient.get(`${sourcesPath(workspaceId)}/${sourceId}/versions`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

export function sourceVersionContentPath(
  workspaceId: string,
  sourceId: string,
  versionId: string,
): string {
  return resolveApiUrl(
    `${sourcesPath(workspaceId)}/${sourceId}/versions/${versionId}/content`,
  );
}

export function sourceContentPath(workspaceId: string, sourceId: string): string {
  return resolveApiUrl(`${sourcesPath(workspaceId)}/${sourceId}/content`);
}

export async function reprocessSource(
  workspaceId: string,
  sourceId: string,
): Promise<WorkspaceSource> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<WorkspaceSource>(
    `${sourcesPath(workspaceId)}/${sourceId}/reprocess`,
  );
}

export interface SourceProcessingProgress {
  readonly jobId: string;
  readonly status: string;
  readonly stage: 'EXTRACT' | 'CHUNK' | 'EMBED' | 'INDEX' | 'FINALIZE' | null;
  readonly progress: number;
  readonly attempt: number;
}

export function fetchSourceProcessing(
  workspaceId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<SourceProcessingProgress | undefined> {
  return apiClient.get<SourceProcessingProgress | undefined>(
    `${sourcesPath(workspaceId)}/${sourceId}/processing`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}

export interface SourceBibliography {
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly publicationYear: number | null;
  readonly doi: string | null;
  readonly venue: string | null;
  readonly url: string | null;
  readonly citationKey: string | null;
}
export interface SourceOrganization {
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly collections: readonly string[];
}
export interface SourceFilters {
  readonly query?: string;
  readonly type?: string;
  readonly uploader?: string;
  readonly status?: string;
  readonly tag?: string;
  readonly collection?: string;
  readonly page?: number;
}
export interface SourceSearchPage {
  readonly items: readonly WorkspaceSource[];
  readonly totalElements: number;
  readonly page: number;
  readonly size: number;
  readonly hasNext: boolean;
}
export interface SourceLibraryFacets {
  readonly total: number;
  readonly ready: number;
  readonly types: Readonly<Partial<Record<SourceType, number>>>;
  readonly uploaders: readonly string[];
  readonly tags: readonly string[];
  readonly collections: readonly string[];
}
export function searchSources(
  workspaceId: string,
  filters: SourceFilters,
  signal?: AbortSignal,
): Promise<SourceSearchPage> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return apiClient.get(`${sourcesPath(workspaceId)}/search?${params.toString()}`, {
    ...(signal === undefined ? {} : { signal }),
  });
}
export function fetchSourceFacets(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<SourceLibraryFacets> {
  return apiClient.get(`${sourcesPath(workspaceId)}/facets`, {
    ...(signal === undefined ? {} : { signal }),
  });
}
export async function saveSourceBibliography(
  workspaceId: string,
  sourceId: string,
  bibliography: SourceBibliography,
): Promise<WorkspaceSource> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.put(`${sourcesPath(workspaceId)}/${sourceId}/bibliography`, {
    body: bibliography,
  });
}
export async function saveSourceOrganization(
  workspaceId: string,
  sourceId: string,
  organization: SourceOrganization,
): Promise<WorkspaceSource> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.put(`${sourcesPath(workspaceId)}/${sourceId}/organization`, {
    body: organization,
  });
}
