import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { useMutation } from '@tanstack/react-query';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import { citationPath, type Citation } from '../../ai/api/generationApi';
import { commentApi, type DocumentComment } from './commentApi';
import { insertCommentCitation } from './insertCommentCitation';
import { commentRange } from './commentAnchor';
import styles from './DocumentComments.module.css';

export function CommentEvidence({
  workspaceId,
  documentId,
  comment,
  editor,
  writable,
  available,
  saved,
  onUpdated,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly comment: DocumentComment;
  readonly editor: Editor | null;
  readonly writable: boolean;
  readonly available: boolean;
  readonly saved: boolean;
  readonly onUpdated: (comment: DocumentComment) => void;
}): ReactElement {
  useUiLocale();
  const request = useRef<string | null>(null);
  const [pending, setPending] = useState<{
    suggestionId: string;
    chunkId: string;
  } | null>(null);
  const confirming = useRef(false);
  const [insertionError, setInsertionError] = useState(false);
  const [liveClaim, setLiveClaim] = useState<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const read = (): void => {
      const range = commentRange(editor.state.doc, comment.anchor.id);
      setLiveClaim(range ? editor.state.doc.textBetween(range.from, range.to) : null);
    };
    read();
    editor.on('transaction', read);
    return () => {
      editor.off('transaction', read);
    };
  }, [editor, comment.anchor.id]);
  const invocation = useMutation({
    mutationFn: () => {
      request.current ??= crypto.randomUUID();
      return commentApi.evidence(workspaceId, documentId, comment.id, request.current);
    },
    onSuccess: (updated) => {
      request.current = null;
      onUpdated(updated);
    },
  });
  const acceptance = useMutation({
    mutationFn: (input: { suggestionId: string; chunkId: string }) =>
      commentApi.acceptEvidence(
        workspaceId,
        documentId,
        comment.id,
        input.suggestionId,
        input.chunkId,
      ),
    onSuccess: (updated) => {
      setPending(null);
      confirming.current = false;
      onUpdated(updated);
    },
  });
  const confirm = acceptance.mutate;
  useEffect(() => {
    if (pending && saved && writable && !confirming.current) {
      confirming.current = true;
      confirm(pending);
    }
  }, [pending, saved, writable, confirm]);
  const enabled = writable && available && comment.status === 'OPEN';
  const busy = invocation.isPending || pending !== null;
  function insert(suggestionId: string, citation: Citation): void {
    if (!editor || !insertCommentCitation(editor, comment.anchor.id, citation)) {
      setInsertionError(true);
      return;
    }
    setInsertionError(false);
    acceptance.reset();
    confirming.current = false;
    setPending({ suggestionId, chunkId: citation.chunkId });
  }
  return (
    <div className={styles.evidenceArea}>
      {writable && comment.status === 'OPEN' ? (
        <Button
          variant="ghost"
          size="compact"
          icon="sparkle"
          disabled={!enabled || !saved || busy}
          busy={invocation.isPending}
          onClick={() => invocation.mutate()}
        >
          {uiText('ui.CommentEvidence.message001')}
        </Button>
      ) : null}
      {invocation.isPending ? (
        <p role="status">{uiText('ui.CommentEvidence.message002')}</p>
      ) : null}
      {invocation.error ? (
        <p role="alert">
          {uiText('ui.CommentEvidence.message003')} {describeError(invocation.error)}{' '}
          {uiText('ui.CommentEvidence.message004')}
        </p>
      ) : null}
      {insertionError ? (
        <p role="alert">{uiText('ui.CommentEvidence.message005')}</p>
      ) : null}
      {pending && !acceptance.error ? (
        <p role="status">
          {saved
            ? uiText('ui.CommentEvidence.message006')
            : uiText('ui.CommentEvidence.message007')}
        </p>
      ) : null}
      {acceptance.error && pending ? (
        <div role="alert">
          <p>
            {uiText('ui.CommentEvidence.message008')} {describeError(acceptance.error)}{' '}
            {uiText('ui.CommentEvidence.message009')}
          </p>
          {writable ? (
            <Button
              variant="ghost"
              size="compact"
              disabled={!saved || acceptance.isPending}
              onClick={() => acceptance.mutate(pending)}
            >
              {uiText('ui.CommentEvidence.message010')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compact"
            disabled={acceptance.isPending}
            onClick={() => {
              setPending(null);
              confirming.current = false;
              acceptance.reset();
            }}
          >
            {uiText('ui.CommentEvidence.message011')}
          </Button>
        </div>
      ) : null}
      {(comment.aiSuggestions ?? []).map((suggestion) => (
        <section
          key={suggestion.id}
          className={styles.aiSuggestion}
          aria-label={uiText('ui.CommentEvidence.message012')}
        >
          <p className={styles.aiHeading}>
            <Icon name="sparkle" size={16} />{' '}
            <strong>{uiText('ui.CommentEvidence.message013')}</strong>
          </p>
          <p className={styles.meta}>
            {uiText('ui.AnalysisProvenance.message014')} {suggestion.requestedByName} ·{' '}
            <time dateTime={suggestion.createdAt}>
              {new Date(suggestion.createdAt).toLocaleString(getIntlLocale())}
            </time>
          </p>
          {suggestion.evidence.generation ? (
            <p className={styles.meta}>
              {suggestion.evidence.generation.model.provider} ·{' '}
              {suggestion.evidence.generation.model.name}
            </p>
          ) : null}
          <blockquote aria-label={uiText('ui.CommentEvidence.message014')}>
            {suggestion.claim}
          </blockquote>
          {available && editor && liveClaim !== suggestion.claim ? (
            <p className={styles.evidenceWarning}>
              {uiText('ui.CommentEvidence.message015')}
            </p>
          ) : null}
          {suggestion.evidence.warnings.map((warning) => (
            <p key={warning} className={styles.evidenceWarning}>
              {warning}
            </p>
          ))}
          {suggestion.evidence.candidates.map((candidate) => (
            <div key={candidate.citation.chunkId} className={styles.evidenceCandidate}>
              <p className={styles.meta}>
                <strong>
                  {
                    {
                      get supporting() {
                        return uiText('ui.ClaimEvidencePanel.message012');
                      },
                      get related() {
                        return uiText('ui.CommentEvidence.message020');
                      },
                      get insufficient() {
                        return uiText('ui.AuthoringPanel.message035');
                      },
                    }[candidate.category]
                  }
                </strong>
              </p>
              <a href={citationPath(candidate.citation)}>
                {candidate.citation.title || uiText('ui.ResearchEvidence.message003')}
                {candidate.citation.pageStart === null
                  ? ''
                  : ` · p. ${candidate.citation.pageStart}`}
              </a>
              <p className={styles.body}>{candidate.reason}</p>
              <details>
                <summary>{uiText('ui.CommentEvidence.message016')}</summary>
                <blockquote>{candidate.snippet}</blockquote>
              </details>
              {suggestion.acceptedChunkIds.includes(candidate.citation.chunkId) ? (
                <p className={styles.meta}>
                  <Icon name="check" size={14} />{' '}
                  {uiText('ui.CommentEvidence.message017')}
                </p>
              ) : writable && candidate.category !== 'insufficient' ? (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={
                    !enabled ||
                    !editor ||
                    !saved ||
                    busy ||
                    liveClaim !== suggestion.claim
                  }
                  onClick={() => insert(suggestion.id, candidate.citation)}
                >
                  {uiText('ui.CommentEvidence.message018')}
                </Button>
              ) : null}
            </div>
          ))}
          <p className={styles.meta}>{uiText('ui.CommentEvidence.message019')}</p>
        </section>
      ))}
    </div>
  );
}
