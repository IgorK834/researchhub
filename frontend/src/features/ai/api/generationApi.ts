import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { ExecutionRecord } from '../../analysis/api/analysisApi';

export interface AnalysisEvidenceReference {
  readonly analysisId: string;
  readonly executionId: string;
  readonly outputId: string;
}
export interface AnalysisCitation extends AnalysisEvidenceReference {
  readonly evidenceId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly executionHash: string;
  readonly contentHash: string;
  readonly codeSha256: string;
  readonly executedAt: string;
  readonly runtimeVersion: string | null;
  readonly inputSources: ExecutionRecord['snapshot']['inputs'];
  readonly provenanceUrl: string;
  readonly detailsUrl: string;
  readonly truncated: boolean;
}
export function analysisCitationPath(citation: AnalysisCitation): string {
  return `/app/workspaces/${encodeURIComponent(citation.workspaceId)}/analyses/${encodeURIComponent(citation.analysisId)}?execution=${encodeURIComponent(citation.executionId)}`;
}

export interface ModelMetadata {
  readonly provider: string;
  readonly name: string;
  readonly version: string;
  readonly structuredOutput: true;
  readonly streaming: false;
}
export interface EvidenceReference {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly processingVersion: string;
  readonly sourceVersionId?: string | null;
}
export interface GenerationCommand {
  readonly instruction: string;
  readonly evidence: readonly EvidenceReference[];
}
export interface Citation extends EvidenceReference {
  readonly workspaceId: string;
  readonly sourceVersionId: string | null;
  readonly contentHash: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly sectionTitle: string | null;
  readonly title?: string | null;
  readonly spans: readonly {
    readonly unitId: string;
    readonly characterStart: number;
    readonly characterEnd: number;
  }[];
}
export interface GeneratedResponse {
  /** Absent/null on historical RH-110 responses. Contains no prompt text. */
  readonly context?: {
    readonly builderVersion: '1.0' | '2.0' | '3.0';
    readonly tokenPolicy: 'utf8-conservative-v1';
    readonly budget: {
      readonly maxTokens: number;
      readonly maxBytes: number;
      readonly collapseExactDuplicates: boolean;
    };
    readonly contextHash: string;
    readonly contextBytes: number;
    readonly tokenUpperBound: number;
    readonly citations: readonly {
      readonly citationKey: string;
      readonly chunkId: string;
      readonly textReference: string | null;
    }[];
  } | null;
  readonly result: {
    readonly schemaVersion: '1.0';
    readonly requestId: string;
    readonly templateId: string;
    readonly templateHash: string;
    readonly model: ModelMetadata;
    readonly providerRequestId: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimated: boolean;
    };
    readonly answer: {
      readonly status: 'SUPPORTED' | 'INSUFFICIENT_EVIDENCE';
      readonly claims: readonly {
        readonly text: string;
        readonly evidenceIds: readonly string[];
      }[];
    };
  };
  readonly evidence: readonly Citation[];
  readonly analysisEvidence?: readonly AnalysisCitation[];
}
const aiPath = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/ai`;

/** Feature parameters and versioned templates are owned by the server. */
export async function generateStructured(
  workspaceId: string,
  command: GenerationCommand,
  signal?: AbortSignal,
): Promise<GeneratedResponse> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<GeneratedResponse>(`${aiPath(workspaceId)}/generations`, {
    body: command,
    ...(signal === undefined ? {} : { signal }),
  });
}
export function fetchGeneration(
  workspaceId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<GeneratedResponse> {
  return apiClient.get<GeneratedResponse>(
    `${aiPath(workspaceId)}/generations/${encodeURIComponent(requestId)}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
export function fetchModelMetadata(workspaceId: string): Promise<ModelMetadata> {
  return apiClient.get<ModelMetadata>(`${aiPath(workspaceId)}/model`);
}

export function citationPath(citation: Citation): string {
  const query = new URLSearchParams({ processingVersion: citation.processingVersion });
  const unit = citation.spans[0];
  if (unit !== undefined) query.set('unit', unit.unitId);
  if (citation.pageStart !== null) query.set('page', String(citation.pageStart));
  return `/app/workspaces/${encodeURIComponent(citation.workspaceId)}/sources/${encodeURIComponent(citation.sourceId)}?${query.toString()}`;
}

export async function validateCitationVersion(
  workspaceId: string,
  sourceId: string,
  processingVersion: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const snapshot = await apiClient.get<unknown>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(sourceId)}/retrieval?${new URLSearchParams({ processingVersion }).toString()}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return snapshot !== undefined;
}
