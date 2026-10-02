import type { WorkspaceSource } from '../../features/sources/api/sourceApi';
import { ApiError } from '../api';

export function sourceApiError(detail: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Request failed',
    status: 503,
    detail,
    code: 'INTERNAL_ERROR',
    rawCode: 'INTERNAL_ERROR',
  });
}

export function sourceFixture(overrides: Partial<WorkspaceSource> = {}): WorkspaceSource {
  return {
    id: 'source-1',
    workspaceId: 'workspace-1',
    originalFilename: 'research.pdf',
    displayName: 'research.pdf',
    sourceType: 'PDF',
    mediaType: 'application/pdf',
    sizeBytes: 2048,
    contentSha256: 'a'.repeat(64),
    uploadedBy: 'user-1',
    createdAt: '2026-09-23T10:15:30Z',
    updatedAt: '2026-09-23T10:15:30Z',
    status: 'READY',
    failureSummary: null,
    activeVersionId: 'version-1',
    activeVersionNumber: 1,
    ...overrides,
  };
}
