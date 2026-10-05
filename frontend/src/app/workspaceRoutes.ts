/** Section URLs and compatibility redirects are a public navigation contract. */
export const WORKSPACE_SECTIONS = {
  overview: 'Overview',
  documents: 'Documents',
  sources: 'Sources',
  ask: 'Ask AI',
  analyses: 'Analyses',
  members: 'Members',
  settings: 'Settings',
} as const;
export type WorkspaceSection = keyof typeof WORKSPACE_SECTIONS;

export function workspaceSectionPath(id: string, section: WorkspaceSection): string {
  const base = `/app/workspaces/${encodeURIComponent(id)}`;
  return section === 'overview' ? base : `${base}/${section}`;
}

/** Preserve every query parameter, including immutable citation/dataset version selectors. */
export function legacyWorkspaceSection(search: string, hash: string): WorkspaceSection {
  if (new URLSearchParams(search).has('analyzeSource')) return 'ask';
  if (hash.includes('document')) return 'documents';
  if (hash.includes('comparison')) return 'ask';
  if (hash.includes('source')) return 'sources';
  if (hash.includes('questions')) return 'ask';
  if (hash.includes('member')) return 'members';
  if (hash.includes('edit-workspace') || hash.includes('archive-workspace'))
    return 'settings';
  return 'overview';
}
