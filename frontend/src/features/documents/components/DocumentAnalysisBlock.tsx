import { useState, type ReactElement } from 'react';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Dialog } from '../../../shared/components/overlays';
import { AnalysisProvenance } from '../../analysis/components/AnalysisProvenance';
import { fetchExecutionRecord } from '../../analysis/api/analysisApi';
import { AnalysisChart } from '../../analysis/components/AnalysisChart';
import { ResultTable } from '../../analysis/components/AnalysisResult';
import { AnalysisFreshnessBanner } from '../../analysis/components/AnalysisWidgets';
import { AnalysisOutputPicker } from '../../analysis/components/AnalysisOutputPicker';
import { fetchSources } from '../../sources/api/sourceApi';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { isAnalysisBlockAttrs, type AnalysisReference } from '../api/analysisReference';
import styles from './DocumentAnalysisBlock.module.css';

export function DocumentAnalysisBlock({
  node,
  editor,
  updateAttributes,
  extension,
}: NodeViewProps): ReactElement {
  const workspaceId = extension.options.workspaceId as string | undefined;
  const attrs = isAnalysisBlockAttrs(node.attrs) ? node.attrs : null;
  const [updating, setUpdating] = useState(false);
  const canEdit = useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });
  return (
    <NodeViewWrapper
      id={attrs ? `analysis-${attrs.blockId}` : undefined}
      className={styles.block}
      contentEditable={false}
      data-analysis-block={attrs?.blockId}
    >
      {!workspaceId || !attrs ? (
        <p role="alert">This analysis reference is unavailable.</p>
      ) : (
        <ReferencedOutput
          workspaceId={workspaceId}
          reference={attrs.reference}
          caption={attrs.caption}
          canEdit={canEdit}
          onUpdate={() => setUpdating(!updating)}
        />
      )}
      {updating && workspaceId && attrs && canEdit ? (
        <div className={styles.update}>
          <h3>Explicitly update this reference</h3>
          <p>
            The saved block will point to the execution you choose. Earlier document
            versions keep their original reference.
          </p>
          <AnalysisOutputPicker
            workspaceId={workspaceId}
            initial={attrs.reference}
            onChoose={(reference) => {
              if (editor.isEditable) updateAttributes({ reference });
              setUpdating(false);
            }}
          />
          <Button variant="ghost" onClick={() => setUpdating(false)}>
            Cancel update
          </Button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
export function ReferencedOutput({
  workspaceId,
  reference,
  caption,
  canEdit,
  onUpdate,
}: {
  readonly workspaceId: string;
  readonly reference: AnalysisReference;
  readonly caption: string;
  readonly canEdit: boolean;
  readonly onUpdate: () => void;
}): ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const record = useQuery({
    queryKey: queryKeys.executionRecord(
      workspaceId,
      reference.analysisId,
      reference.executionId,
    ),
    queryFn: ({ signal }) =>
      fetchExecutionRecord(
        workspaceId,
        reference.analysisId,
        reference.executionId,
        signal,
      ),
  });
  const sources = useQuery({
    queryKey: queryKeys.sources(workspaceId),
    queryFn: ({ signal }) => fetchSources(workspaceId, signal),
  });
  const saved = record.error ? undefined : record.data;
  const output =
    saved?.execution.status === 'SUCCEEDED'
      ? saved.execution.result?.outputs.find(
          (output) =>
            output.name === reference.outputId &&
            (output.kind === 'TEXT' ? 'SUMMARY' : output.kind) === reference.renderMode,
        )
      : undefined;
  const chart = saved?.charts.find((chart) => chart.name === reference.outputId);
  const index = saved?.execution.result?.outputs.findIndex(
    (output) => output.name === reference.outputId,
  );
  const details = `/app/workspaces/${workspaceId}/analyses/${reference.analysisId}?execution=${encodeURIComponent(reference.executionId)}#output-${index ?? 0}`;
  const changed =
    saved?.snapshot.inputs.some((input) =>
      sources.data?.some(
        (source) =>
          source.id === input.sourceId &&
          source.activeVersionId !== input.sourceVersionId,
      ),
    ) ?? false;
  return (
    <>
      {record.isPending ? <p role="status">Loading referenced result…</p> : null}
      {record.error ? (
        <p role="alert">
          Could not load referenced result: {describeError(record.error)}
        </p>
      ) : null}
      {saved && !output ? (
        <p role="alert">
          The selected saved output is unavailable. Choose a valid successful execution.
        </p>
      ) : null}
      {output?.kind === 'CHART' && chart && reference.renderMode === 'CHART' ? (
        <AnalysisChart
          workspaceId={workspaceId}
          chart={chart}
          onDetails={() => setDetailsOpen(true)}
        />
      ) : null}
      {output?.kind === 'TABLE' && reference.renderMode === 'TABLE' ? (
        <ResultTable output={output} />
      ) : null}
      {output?.kind === 'TEXT' && reference.renderMode === 'SUMMARY' ? (
        <p className={styles.summary}>{output.text}</p>
      ) : null}
      {caption ? <p className={styles.caption}>{caption}</p> : null}
      <div className={styles.footer}>
        <span>
          Analysis {reference.analysisId.slice(0, 8)} · Execution{' '}
          {reference.executionId.slice(0, 8)}
        </span>
        <Link to={details} target="_blank" rel="noreferrer">
          Open analysis provenance
        </Link>
        {canEdit ? (
          <Button variant="ghost" onClick={onUpdate}>
            Update reference
          </Button>
        ) : null}
      </div>
      {saved ? (
        <p className={styles.sources}>
          Source:{' '}
          {saved.snapshot.inputs
            .map(
              (input) =>
                `${input.originalFilename} · v${input.versionNumber} · ${input.sheets.map((sheet) => sheet.name).join(', ')}`,
            )
            .join('; ')}
        </p>
      ) : null}
      <AnalysisFreshnessBanner
        outOfDate={changed}
        message="An input source has a newer version. This block keeps displaying its historical result until you explicitly choose a different saved execution."
      />
      {sources.error ? (
        <p role="status">
          Source freshness could not be checked. The historical execution reference is
          unchanged.
        </p>
      ) : null}
      {saved ? (
        <Dialog
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Analysis provenance"
        >
          <AnalysisProvenance record={saved} />
        </Dialog>
      ) : null}
    </>
  );
}
