/**
 * Central TanStack Query key factory.
 *
 * Convention: the first element names the resource collection, the following elements narrow it
 * from broadest to most specific. That ordering makes prefix invalidation work — invalidating
 * `['workspaces']` also invalidates `['workspaces', id]`, because TanStack Query matches keys by
 * prefix. Build keys only through this factory so invalidation targets stay predictable.
 *
 * See docs/development/frontend-api.md for the invalidation rules.
 */
export const queryKeys = {
  health: () => ['health'] as const,

  /**
   * The signed-in user. Cached under one key so a login writes it and a reload re-fetches it.
   *
   * Holds only the public user metadata the backend returns. The session id lives in an HttpOnly
   * cookie the page cannot read, and the password is never kept anywhere — see
   * docs/adr/ADR-001-authentication.md.
   */
  currentUser: () => ['auth', 'me'] as const,
  aiConversations: (workspaceId: string) =>
    ['workspaces', workspaceId, 'ai', 'conversations'] as const,
  aiConversation: (workspaceId: string, conversationId: string) =>
    ['workspaces', workspaceId, 'ai', 'conversations', conversationId] as const,

  workspaces: () => ['workspaces'] as const,
  workspace: (workspaceId: string) => ['workspaces', workspaceId] as const,

  /**
   * One workspace's members.
   *
   * Nested under the workspace rather than given its own top-level collection, because a roster only
   * exists inside a workspace. The nesting is load-bearing: invalidating `['workspaces']` after a
   * membership change also refreshes this key by prefix, so a role change cannot leave a stale roster
   * cached behind an up-to-date workspace.
   */
  workspaceMembers: (workspaceId: string) =>
    ['workspaces', workspaceId, 'members'] as const,

  documents: (workspaceId: string) => ['documents', workspaceId] as const,
  document: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, documentId] as const,
  /**
   * One document's version history. Nested under the document, so invalidating the document by prefix also
   * refreshes its history — and invalidating only the history leaves the document itself alone.
   */
  documentVersions: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, documentId, 'versions'] as const,
  documentComments: (workspaceId: string, documentId: string) =>
    ['documents', workspaceId, documentId, 'comments'] as const,
  commentThread: (workspaceId: string, documentId: string, commentId: string) =>
    ['documents', workspaceId, documentId, 'comments', commentId] as const,
  documentVersion: (workspaceId: string, documentId: string, versionId: string) =>
    ['documents', workspaceId, documentId, 'versions', versionId] as const,

  citationFragment: (
    workspaceId: string,
    sourceId: string,
    processingVersion: string,
    chunkId: string,
    sourceVersionId: string | null,
    contentHash: string,
  ) =>
    [
      'sources',
      workspaceId,
      sourceId,
      'retrieval',
      processingVersion,
      chunkId,
      sourceVersionId,
      contentHash,
    ] as const,

  sources: (workspaceId: string) => ['sources', workspaceId] as const,
  source: (workspaceId: string, sourceId: string) =>
    ['sources', workspaceId, sourceId] as const,
  sourceVersions: (workspaceId: string, sourceId: string) =>
    ['sources', workspaceId, sourceId, 'versions'] as const,
  datasetPreview: (workspaceId: string, sourceId: string, versionId?: string) =>
    ['analysis', workspaceId, 'datasets', sourceId, versionId ?? 'active'] as const,
  analyses: (workspaceId: string) => ['analyses', workspaceId] as const,
  analysis: (workspaceId: string, analysisId: string) =>
    ['analyses', workspaceId, analysisId] as const,
  executions: (workspaceId: string, analysisId: string) =>
    ['analyses', workspaceId, analysisId, 'executions'] as const,
  executionRecord: (workspaceId: string, analysisId: string, executionId: string) =>
    ['analyses', workspaceId, analysisId, 'executions', executionId, 'record'] as const,

  sourceExtraction: (workspaceId: string, sourceId: string, revision?: string) =>
    (revision === undefined
      ? ['sources', workspaceId, sourceId, 'extraction']
      : ['sources', workspaceId, sourceId, 'extraction', revision]) as readonly string[],
  extractionRuns: (workspaceId: string, sourceId: string) =>
    ['sources', workspaceId, sourceId, 'extraction', 'runs'] as const,

  sourceProcessing: (workspaceId: string, sourceId: string) =>
    ['sources', workspaceId, sourceId, 'processing'] as const,

  job: (jobId: string) => ['jobs', jobId] as const,
} as const;
