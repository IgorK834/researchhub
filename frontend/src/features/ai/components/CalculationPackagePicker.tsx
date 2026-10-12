import { useRef, useState, type ReactElement } from 'react';
import { AnalysisOutputPicker } from '../../analysis/components/AnalysisOutputPicker';
import type { AnalysisReference } from '../../documents/api/analysisReference';
import { Button } from '../../../shared/components/Button';
import { Select } from '../../../shared/components/forms';
import { describeError } from '../../../shared/api';
import {
  prepareCalculationProposal,
  type CanvasProposal,
} from '../api/canvasProposalApi';
import { CanvasProposalPreview } from './CanvasProposalPreview';

export function CalculationPackagePicker({
  workspaceId,
  documentId,
  contextId,
  conversationId = null,
  turnId = null,
  canApply,
  onApplying,
  onApplied,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly contextId: string;
  readonly conversationId?: string | null;
  readonly turnId?: string | null;
  readonly canApply: boolean;
  readonly onApplying?: (value: boolean) => void;
  readonly onApplied?: () => Promise<void>;
}): ReactElement {
  const [reference, setReference] = useState<AnalysisReference | null>(null);
  const [selection, setSelection] = useState<'FULL' | 'TABLE' | 'CHART'>('FULL');
  const [proposal, setProposal] = useState<CanvasProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const identity = useRef(crypto.randomUUID());
  return (
    <section aria-label="Insert saved calculation package">
      <h3>Insert a saved result package</h3>
      <p>
        Choose the exact saved execution. Review the complete solution, table or chart
        before one atomic insertion.
      </p>
      <AnalysisOutputPicker
        workspaceId={workspaceId}
        disabled={busy || !canApply}
        onChoose={(ref) => {
          setReference(ref);
          setProposal(null);
          setSelection('FULL');
          identity.current = crypto.randomUUID();
        }}
      />
      {reference ? (
        <>
          <Select
            label="Package contents"
            value={selection}
            disabled={busy}
            onChange={(e) => {
              setSelection(e.target.value as 'FULL' | 'TABLE' | 'CHART');
              setProposal(null);
              identity.current = crypto.randomUUID();
            }}
          >
            <option value="FULL">Complete saved package</option>
            {reference.renderMode === 'TABLE' ? (
              <option value="TABLE">Selected table only</option>
            ) : null}
            {reference.renderMode === 'CHART' ? (
              <option value="CHART">Selected chart only</option>
            ) : null}
          </Select>
          <Button
            disabled={busy || !canApply}
            onClick={() => {
              setBusy(true);
              setError(null);
              void prepareCalculationProposal(workspaceId, documentId, {
                clientProposalId: identity.current,
                contextId,
                analysisId: reference.analysisId,
                executionId: reference.executionId,
                selection,
                outputId: selection === 'FULL' ? null : reference.outputId,
                conversationId: turnId ? conversationId : null,
                turnId,
              })
                .then(setProposal)
                .catch(setError)
                .finally(() => setBusy(false));
            }}
          >
            Preview saved package
          </Button>
        </>
      ) : null}
      {error ? <p role="alert">{describeError(error)}</p> : null}
      {proposal ? (
        <CanvasProposalPreview
          workspaceId={workspaceId}
          documentId={documentId}
          proposalId={proposal.id}
          canEdit
          canApply={canApply}
          onApplying={onApplying}
          onApplied={onApplied}
        />
      ) : null}
    </section>
  );
}
