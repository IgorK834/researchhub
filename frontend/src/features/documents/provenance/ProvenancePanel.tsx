import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient, describeError } from '../../../shared/api';
import { SlideOver } from '../../../shared/components/overlays';
import type { PreviewCitation } from '../../ai/components/Citations';
import { citationPath } from '../../ai/api/generationApi';
import { fetchSourceVersions } from '../../sources/api/sourceApi';
import {
  fetchExecutionRecord,
  type ExecutionRecord,
} from '../../analysis/api/analysisApi';
import { fetchSolution, type SolutionBundle } from '../../analysis/api/solutionApi';
import { AnalysisProvenance } from '../../analysis/components/AnalysisProvenance';
import type { AnalysisReference } from '../api/analysisReference';
import type { OriginOperation } from './DocumentProvenance';
import styles from './DocumentProvenance.module.css';

export type ProvenanceTarget = { readonly trigger?: HTMLElement } & (
  | { kind: 'citation'; citation: PreviewCitation }
  | { kind: 'analysis'; workspaceId: string; reference: AnalysisReference }
  | { kind: 'block'; workspaceId: string; documentId: string; blockId: string | null }
);
const OpenProvenance = createContext<((target: ProvenanceTarget) => void) | null>(null);
export const useOpenProvenance = () => useContext(OpenProvenance);

export function ProvenanceProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [target, setTarget] = useState<ProvenanceTarget | null>(null);
  return (
    <OpenProvenance.Provider value={setTarget}>
      {children}
      <ProvenancePanel target={target} onClose={() => setTarget(null)} />
    </OpenProvenance.Provider>
  );
}
export function ProvenancePanel({
  target,
  onClose,
}: {
  readonly target: ProvenanceTarget | null;
  readonly onClose: () => void;
}): ReactElement {
  const returnFocusRef = useMemo(
    () => ({ current: target?.trigger ?? null }),
    [target?.trigger],
  );
  return (
    <SlideOver
      open={target !== null}
      title="Provenance"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className={styles.inspector}>
        {target?.kind === 'citation' ? (
          <CitationProvenance citation={target.citation} />
        ) : null}
        {target?.kind === 'analysis' ? (
          <AnalysisDetails
            workspaceId={target.workspaceId}
            reference={target.reference}
          />
        ) : null}
        {target?.kind === 'block' ? <BlockDetails {...target} /> : null}
      </div>
    </SlideOver>
  );
}
function CitationProvenance({
  citation,
}: {
  readonly citation: PreviewCitation;
}): ReactElement {
  const versions = useQuery({
    queryKey: ['citation-provenance', citation.workspaceId, citation.sourceId],
    queryFn: ({ signal }) =>
      fetchSourceVersions(citation.workspaceId, citation.sourceId, signal),
    enabled: citation.sourceVersionId !== null,
    retry: false,
  });
  const version = versions.data?.find((v) => v.id === citation.sourceVersionId);
  return (
    <>
      <h3>Citation provenance</h3>
      {citation.sourceVersionId !== null && versions.isPending ? (
        <p role="status">Loading source provenance…</p>
      ) : null}
      {versions.error ? (
        <p role="alert">
          Could not load source provenance: {describeError(versions.error)}
        </p>
      ) : null}
      {versions.data && !version ? (
        <p role="status">The immutable source version is unavailable.</p>
      ) : null}
      <dl>
        <dt>Source name</dt>
        <dd>{version?.originalFilename ?? citation.title ?? 'Not recorded'}</dd>
        <dt>Immutable source version</dt>
        <dd>
          {citation.sourceVersionId ?? 'Not recorded for this legacy citation'}
          {version ? ` · v${version.versionNumber}` : ''}
        </dd>
        <dt>Page or fragment</dt>
        <dd>
          {citation.pageStart !== null
            ? `Page ${citation.pageStart}${citation.pageEnd !== null && citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ''}`
            : (citation.sectionTitle ??
              (citation.spans.map((s) => s.unitId).join(', ') || 'Not recorded'))}
        </dd>
        <dt>Fragment content hash (SHA-256)</dt>
        <dd>
          <code>{citation.contentHash}</code>
        </dd>
        <dt>Source content hash (SHA-256)</dt>
        <dd>
          <code>{version?.contentSha256 ?? 'Not recorded'}</code>
        </dd>
        <dt>Processing version</dt>
        <dd>{citation.processingVersion}</dd>
      </dl>
      <a href={citationPath({ ...citation, chunkId: citation.chunkId ?? '' })}>
        Open source reader at this version
      </a>
    </>
  );
}
function AnalysisDetails({
  workspaceId,
  reference,
}: {
  readonly workspaceId: string;
  readonly reference: AnalysisReference;
}): ReactElement {
  const saved = useQuery<ExecutionRecord | SolutionBundle>({
    queryKey: [
      'panel-analysis-provenance',
      workspaceId,
      reference.analysisId,
      reference.executionId,
      reference.workload,
    ],
    queryFn: ({ signal }) =>
      reference.workload === 'PROBLEM'
        ? fetchSolution(workspaceId, reference.analysisId, reference.executionId, signal)
        : fetchExecutionRecord(
            workspaceId,
            reference.analysisId,
            reference.executionId,
            signal,
          ),
    retry: false,
  });
  if (saved.isPending) return <p role="status">Loading analysis provenance…</p>;
  if (saved.error)
    return (
      <p role="alert">Could not load analysis provenance: {describeError(saved.error)}</p>
    );
  if ('execution' in saved.data) return <AnalysisProvenance record={saved.data} />;
  const solution = saved.data;
  return (
    <>
      <h3>Scientific analysis provenance</h3>
      <dl>
        <dt>Input hash</dt>
        <dd>
          <code>{solution.inputHash}</code>
        </dd>
        <dt>Plan hash</dt>
        <dd>
          <code>{solution.planHash}</code>
        </dd>
        <dt>Runtime version</dt>
        <dd>{solution.runtimeVersion}</dd>
        <dt>Runtime image</dt>
        <dd>{solution.imageId}</dd>
        <dt>Generated code hashes</dt>
        <dd>
          {Object.entries(solution.codeHashes).map(([name, hash]) => (
            <p key={name}>
              {name}: <code>{hash}</code>
            </p>
          ))}
        </dd>
        <dt>Outputs</dt>
        <dd>{solution.outputs.map((o) => o.name).join(', ') || 'None'}</dd>
        <dt>Duration</dt>
        <dd>Not recorded in this solution contract</dd>
        <dt>Re-run origin</dt>
        <dd>
          <pre>
            {solution.origin
              ? JSON.stringify(solution.origin, null, 2)
              : 'Original execution'}
          </pre>
        </dd>
      </dl>
    </>
  );
}
function BlockDetails({
  workspaceId,
  documentId,
  blockId,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly blockId: string | null;
}): ReactElement {
  const history = useQuery({
    queryKey: ['document-provenance', workspaceId, documentId, blockId],
    queryFn: ({ signal }) =>
      apiClient.get<OriginOperation[]>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId!)}/provenance`,
        { signal },
      ),
    enabled: blockId !== null,
    retry: false,
  });
  if (blockId === null) return <p>No origin was recorded for this legacy block.</p>;
  if (history.isPending) return <p role="status">Loading block provenance…</p>;
  if (history.error)
    return (
      <p role="alert">Could not load block provenance: {describeError(history.error)}</p>
    );
  if (history.data.length === 0) return <p>No saved provenance for this block.</p>;
  return (
    <>
      <h3>Recorded block operations</h3>
      <p>
        These operations record origin at a saved revision. Later edits may change the
        wording.
      </p>
      <ol>
        {history.data.map((op) => (
          <li key={op.id}>
            <strong>{op.category}</strong>
            <dl>
              {op.category.startsWith('AI_') ? (
                <>
                  <dt>Model name</dt>
                  <dd>{op.metadata.model?.name ?? 'Not recorded'}</dd>
                  <dt>Model version</dt>
                  <dd>{op.metadata.model?.version ?? 'Not recorded'}</dd>
                  <dt>Template version</dt>
                  <dd>
                    {op.metadata.templateId ?? 'Not recorded'}
                    {op.metadata.templateHash ? (
                      <code>{op.metadata.templateHash}</code>
                    ) : null}
                  </dd>
                </>
              ) : null}
              <dt>{op.operationType === 'AI_ACCEPTED' ? 'Approving user' : 'Actor'}</dt>
              <dd>
                {op.actorName} · {op.actorUserId ?? 'System'}
              </dd>
              <dt>
                {op.operationType === 'AI_ACCEPTED' ? 'Approved at' : 'Recorded at'}
              </dt>
              <dd>
                <time dateTime={op.createdAt}>
                  {new Date(op.createdAt).toLocaleString()}
                </time>
              </dd>
              <dt>Document revision</dt>
              <dd>{op.documentRevision}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}
