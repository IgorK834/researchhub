import { resolveApiUrl } from '../../../shared/api';
import type { ExtractedUnit } from './sourceExtraction';

export function sourceLocationPath(
  workspaceId: string,
  sourceId: string,
  unit: ExtractedUnit,
): string {
  const query = new URLSearchParams({
    unit: unit.chunkId,
    parserVersion: unit.parserVersion,
  });
  if (unit.pageNumber !== null) query.set('page', String(unit.pageNumber));
  if (unit.location?.sheetName) query.set('sheet', unit.location.sheetName);
  return `/app/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(sourceId)}?${query.toString()}`;
}

export function pdfPreviewPath(
  workspaceId: string,
  sourceId: string,
  page: number,
): string {
  return `${resolveApiUrl(`/api/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(sourceId)}/preview`)}#page=${String(page)}`;
}

export function parsePdfPage(value: string | null, count?: number): number | null {
  if (value === null) return 1;
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= (count && count > 0 ? count : 10_000)
    ? number
    : null;
}
