import type { SourceTextHit } from '../api/sourceTextSearch';
import type {
  ExternalSearch,
  ExternalReference,
  ExternalPage,
} from '../api/externalSourceApi';

export const textHit = (id = 'c1', page: number | null = 14): SourceTextHit => ({
  chunk: {
    chunkId: id,
    workspaceId: 'w1',
    sourceId: 's1',
    sourceVersionId: 'v1',
    content: 'Temperature affects solar efficiency. <img src=x onerror=bad()>',
    contentHash: 'hash',
    processingVersion: 'p1',
    pageStart: page,
    pageEnd: page,
    sectionTitle: 'Temperature dependence',
    spans: [{ unitId: 'unit-14', characterStart: 0, characterEnd: 50 }],
  },
  score: 0.1,
  vectorSimilarity: 0.8,
  lexicalScore: 0.4,
});
export const externalSearch: ExternalSearch = {
  id: 'search1',
  workspaceId: 'w1',
  evidenceType: 'EXTERNAL_WEB',
  provider: 'BRAVE',
  query: 'solar',
  searchedBy: 'u1',
  searchedAt: '2026-10-07T12:00:00Z',
  results: [
    {
      id: 'hit1',
      title: 'Solar web paper',
      url: 'https://example.org/paper',
      snippet: '<script>inert</script> Web snippet.',
    },
  ],
};
export const externalReference: ExternalReference = {
  ...externalSearch.results[0]!,
  id: 'ref1',
  workspaceId: 'w1',
  evidenceType: 'EXTERNAL_WEB',
  provider: 'BRAVE',
  query: 'solar',
  searchId: 'search1',
  resultId: 'hit1',
  searchedBy: 'u1',
  discoveredAt: '2026-10-07T12:00:00Z',
  recordedBy: 'u1',
  recordedAt: '2026-10-07T12:01:00Z',
  snapshotSha256: 'a'.repeat(64),
};
export const externalPage = (items: readonly ExternalReference[] = []): ExternalPage => ({
  items,
  totalElements: items.length,
  page: 0,
  size: 30,
  hasNext: false,
});
