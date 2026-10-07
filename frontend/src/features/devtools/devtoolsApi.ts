import { apiClient } from '../../shared/api';
import type {
  Citation,
  GeneratedResponse,
  ModelMetadata,
  AnalysisEvidenceReference,
} from '../ai/api/generationApi';
import type { QuestionResponse } from '../ai/api/questionApi';

export type Feature =
  | 'ASK_WORKSPACE'
  | 'SECTION_GENERATION'
  | 'REWRITE'
  | 'EVIDENCE_SEARCH'
  | 'SOURCE_ANALYSIS'
  | 'ANALYSIS_PLANNING'
  | 'GROUNDED_RESPONSE';
export interface UsageEvent {
  readonly requestId: string;
  readonly correlationId: string;
  readonly feature: Feature;
  readonly model: ModelMetadata | null;
  readonly templateId: string;
  readonly templateHash: string;
  readonly usage: GeneratedResponse['result']['usage'] | null;
  readonly latencyMs: number;
  readonly cost: {
    readonly usd: number;
    readonly pricingVersion: string;
    readonly estimated: boolean;
  } | null;
  readonly status: string;
  readonly errorCode: string | null;
}
export interface Aggregate {
  readonly feature: Feature;
  readonly provider: string | null;
  readonly model: string | null;
  readonly modelVersion: string | null;
  readonly templateId: string;
  readonly status: string;
  readonly requests: number;
  readonly usageKnown: number;
  readonly estimatedUsageRequests: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costKnown: number;
  readonly estimatedCostUsd: number | null;
  readonly averageLatencyMs: number;
}
export interface TraceSummary {
  readonly id: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly status: string;
  readonly errorCode: string | null;
  readonly generationRequestId: string | null;
  readonly query: string | null;
  readonly retrievedChunks: number;
}
export interface Trace extends Omit<TraceSummary, 'retrievedChunks'> {
  readonly workspaceId: string;
  readonly selectedSourceIds: readonly string[] | null;
  readonly selectedAnalysisOutputs: readonly AnalysisEvidenceReference[];
  readonly topK: number;
  readonly parameters: {
    readonly temperature: number | null;
    readonly maxOutputTokens: number;
  };
  readonly templateId: string;
  readonly templateHash: string;
  readonly retrievalLatencyMs: number | null;
  readonly context: GeneratedResponse['context'];
  readonly response: QuestionResponse | null;
}
export interface Chunk {
  readonly hit: {
    readonly citation: Citation;
    readonly score: number;
    readonly vectorSimilarity: number;
    readonly lexicalScore: number;
    readonly contentBytes: number;
    readonly embeddingModel: {
      readonly provider: string;
      readonly name: string;
      readonly version: string;
    };
  };
  readonly text: string | null;
  readonly availability: string;
  readonly citationKey: string | null;
  readonly textReference: string | null;
}
export interface Detail {
  readonly trace: Trace;
  readonly usage: UsageEvent | null;
  readonly chunks: readonly Chunk[];
  readonly retrievalStrategy: string;
  readonly reranking: string;
}
export interface Overview {
  readonly days: number;
  readonly contentCaptureEnabled: boolean;
  readonly usage: readonly Aggregate[];
  readonly traces: readonly TraceSummary[];
}
const path = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/devtools/ai`;
export const loadOverview = (
  workspaceId: string,
  days: number,
  signal?: AbortSignal,
): Promise<Overview> =>
  apiClient.get<Overview>(`${path(workspaceId)}?days=${days}`, { signal });
export const loadTrace = (
  workspaceId: string,
  id: string,
  signal?: AbortSignal,
): Promise<Detail> =>
  apiClient.get<Detail>(`${path(workspaceId)}/traces/${encodeURIComponent(id)}`, {
    signal,
  });
