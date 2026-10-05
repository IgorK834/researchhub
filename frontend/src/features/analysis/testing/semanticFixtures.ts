import { savedRecord, savedAnalysis } from './analysisFixtures';
import type { AnalysisReference } from '../../documents/api/analysisReference';
import type { AnalysisCitation } from '../../ai/api/generationApi';
export const analysisId = '11111111-1111-4111-8111-111111111111';
export const executionId = '22222222-2222-4222-8222-222222222222';
export const newerId = '33333333-3333-4333-8333-333333333333';
export const blockId = '44444444-4444-4444-8444-444444444444';
export const reference: AnalysisReference = {
  analysisId,
  executionId,
  outputId: 'impedance-chart',
  renderMode: 'CHART',
};
export function semanticRecord(id = executionId) {
  const record = savedRecord(id, id === executionId ? 1 : 2);
  record.execution.analysisId = analysisId;
  record.charts[0]!.sourceAnalysisId = analysisId;
  return record;
}
export function semanticAnalysis() {
  return { ...savedAnalysis(), id: analysisId };
}
export function computedCitation(): AnalysisCitation {
  return {
    analysisId,
    executionId,
    outputId: 'impedance-table',
    evidenceId: 'f'.repeat(64),
    workspaceId: 'w',
    title: 'Computed impedance',
    executionHash: 'e'.repeat(64),
    contentHash: 'b'.repeat(64),
    codeSha256: 'c'.repeat(64),
    executedAt: '2026-10-01T12:00:03Z',
    runtimeVersion: '1.1.0',
    inputSources: semanticRecord().snapshot.inputs,
    provenanceUrl: '/provenance',
    detailsUrl: '/details',
    truncated: false,
  };
}
