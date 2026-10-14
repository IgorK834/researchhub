import { apiClient } from '../../shared/api';
export interface WorkspacePerson {
  readonly userId: string;
  readonly displayLabel: string;
}
export const memberApi = {
  search: (workspaceId: string, query: string): Promise<WorkspacePerson[]> =>
    apiClient.get(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/people?q=${encodeURIComponent(query)}`,
    ),
};
export interface Mention extends WorkspacePerson {
  readonly start: number;
  readonly end: number;
  readonly available?: boolean;
}
/** UTF-16 ranges are relative to the canonical plain comment body, never to the document/Yjs anchor. */
export function retainMentions(
  before: string,
  after: string,
  mentions: readonly Mention[],
): Mention[] {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const oldEnd = before.length - suffix,
    delta = after.length - before.length;
  return mentions.flatMap((m) => {
    if (m.end <= prefix) return [m];
    if (m.start >= oldEnd) return [{ ...m, start: m.start + delta, end: m.end + delta }];
    return [];
  });
}
export function canonicalMentions(body: string, mentions: readonly Mention[]): Mention[] {
  const leading = body.length - body.trimStart().length;
  return mentions.map((m) => ({ ...m, start: m.start - leading, end: m.end - leading }));
}

/** Explicit selection replacement must preserve identities even when two members share a label. */
export function replaceMentionRanges(
  mentions: readonly Mention[],
  start: number,
  end: number,
  insertedLength: number,
): Mention[] {
  const delta = insertedLength - (end - start);
  return mentions.flatMap((m) => {
    if (m.end <= start) return [m];
    if (m.start >= end) return [{ ...m, start: m.start + delta, end: m.end + delta }];
    return [];
  });
}
