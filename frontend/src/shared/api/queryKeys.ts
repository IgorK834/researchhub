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

  sources: (workspaceId: string) => ['sources', workspaceId] as const,
  source: (workspaceId: string, sourceId: string) =>
    ['sources', workspaceId, sourceId] as const,

  job: (jobId: string) => ['jobs', jobId] as const,
} as const;
