import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import {
  acceptCanvasProposal,
  fetchCanvasProposal,
  rejectCanvasProposal,
  undoCanvasOperation,
} from '../api/canvasProposalApi';
import { citationPath } from '../api/generationApi';
import { ReferencedOutput } from '../../documents/components/DocumentAnalysisBlock';
import { ProblemReferencedOutput } from '../../documents/components/ProblemReferencedOutput';

/** Review is React-only: it cannot enter the editor's autosave or undo history. */
export function CanvasProposalPreview({
  workspaceId,
  documentId,
  proposalId,
  canEdit,
  canApply = true,
  onApplying,
  onApplied,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly proposalId: string;
  readonly canEdit: boolean;
  readonly canApply?: boolean;
  readonly onApplying?: (value: boolean) => void;
  readonly onApplied?: () => Promise<void>;
}): ReactElement {
  useUiLocale();
  const cache = useQueryClient();
  const key = ['canvas-proposal', workspaceId, documentId, proposalId];
  const proposal = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      fetchCanvasProposal(workspaceId, documentId, proposalId, signal),
    retry: false,
  });
  const acceptId = useRef(crypto.randomUUID());
  const undoId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [undone, setUndone] = useState(false);
  const running = useRef(false);
  const act = async (kind: 'ACCEPT' | 'REJECT' | 'UNDO'): Promise<void> => {
    if (running.current || !proposal.data) return;
    running.current = true;
    setBusy(true);
    setError(null);
    onApplying?.(true);
    try {
      if (kind === 'REJECT')
        await rejectCanvasProposal(workspaceId, documentId, proposalId);
      else if (kind === 'ACCEPT')
        await acceptCanvasProposal(
          workspaceId,
          documentId,
          proposal.data,
          acceptId.current,
        );
      else if (proposal.data.operationId) {
        await undoCanvasOperation(
          workspaceId,
          documentId,
          proposal.data.operationId,
          undoId.current,
        );
        setUndone(true);
      }
      if (kind !== 'REJECT') await onApplied?.();
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({
          queryKey: queryKeys.document(workspaceId, documentId),
        }),
        cache.invalidateQueries({ queryKey: queryKeys.aiConversations(workspaceId) }),
      ]);
    } catch (failure) {
      setError(failure);
    } finally {
      running.current = false;
      setBusy(false);
      onApplying?.(false);
    }
  };
  const p = proposal.data;
  return (
    <section aria-label={uiText('ui.CanvasProposalPreview.message001')}>
      {proposal.isPending ? (
        <p role="status">{uiText('ui.CanvasProposalPreview.message002')}</p>
      ) : null}
      {proposal.error || error ? (
        <p role="alert">{describeError(error ?? proposal.error)}</p>
      ) : null}
      {proposal.error ? (
        <Button
          variant="secondary"
          onClick={() => {
            void proposal.refetch();
          }}
        >
          {uiText('ui.CanvasProposalPreview.message003')}
        </Button>
      ) : null}
      {p ? (
        <>
          <strong>
            {p.mode === 'INSERT_AT_ANCHOR'
              ? uiText('ui.CanvasProposalPreview.message004')
              : uiText('ui.CanvasProposalPreview.message005')}
          </strong>
          {p.mode === 'REPLACE_RANGE' ? (
            <details>
              <summary>{uiText('ui.CanvasProposalPreview.message006')}</summary>
              <p>{p.originalText}</p>
            </details>
          ) : null}
          {p.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          {p.calculation?.blocks.map((block) =>
            block.attrs.reference.workload === 'PROBLEM' ? (
              <ProblemReferencedOutput
                key={block.attrs.blockId}
                workspaceId={workspaceId}
                reference={block.attrs.reference}
                caption={block.attrs.caption}
              />
            ) : (
              <ReferencedOutput
                key={block.attrs.blockId}
                workspaceId={workspaceId}
                reference={block.attrs.reference}
                caption={block.attrs.caption}
                canEdit={false}
                onUpdate={() => undefined}
              />
            ),
          )}
          {p.citations.map((c) => (
            <a
              key={c.chunkId}
              href={`${citationPath(c)}${c.sourceVersionId ? `&version=${encodeURIComponent(c.sourceVersionId)}` : ''}`}
            >
              {c.title ?? uiText('ui.AiDraftBlock.message007')}{' '}
            </a>
          ))}
          {p.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p role="status">
            {undone || p.compensationId
              ? uiText('ui.CanvasProposalPreview.message007')
              : uiText('ui.CanvasProposalPreview.message008', {
                  value0: p.state.toLowerCase(),
                })}
          </p>
          {canEdit && p.state === 'PENDING' ? (
            <>
              {!canApply ? <p>{uiText('ui.CanvasProposalPreview.message009')}</p> : null}
              <Button
                disabled={busy || !canApply}
                onClick={() => {
                  void act('ACCEPT');
                }}
              >
                {p.mode === 'INSERT_AT_ANCHOR'
                  ? uiText('ui.CanvasProposalPreview.message010')
                  : uiText('ui.CanvasProposalPreview.message011')}
              </Button>{' '}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void act('REJECT');
                }}
              >
                {uiText('ui.CanvasProposalPreview.message012')}
              </Button>
            </>
          ) : null}
          {canEdit &&
          p.state === 'ACCEPTED' &&
          p.operationId &&
          !undone &&
          !p.compensationId ? (
            <Button
              variant="secondary"
              disabled={busy || !canApply}
              onClick={() => {
                void act('UNDO');
              }}
            >
              {uiText('ui.CanvasProposalPreview.message013')}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
