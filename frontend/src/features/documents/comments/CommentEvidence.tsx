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
          Find evidence with AI
        </Button>
      ) : null}
      {invocation.isPending ? (
        <p role="status">Researching the highlighted claim…</p>
      ) : null}
      {invocation.error ? (
        <p role="alert">
          Could not find evidence: {describeError(invocation.error)} You can retry this
          request.
        </p>
      ) : null}
      {insertionError ? (
        <p role="alert">
          The passage is unavailable or the editor is read-only. Select live text before
          inserting a citation.
        </p>
      ) : null}
      {pending && !acceptance.error ? (
        <p role="status">
          {saved
            ? 'Confirming the saved citation…'
            : 'Waiting for the inserted citation to be saved…'}
        </p>
      ) : null}
      {acceptance.error && pending ? (
        <div role="alert">
          <p>
            Could not confirm the citation: {describeError(acceptance.error)} The document
            keeps your edit.
          </p>
          {writable ? (
            <Button
              variant="ghost"
              size="compact"
              disabled={!saved || acceptance.isPending}
              onClick={() => acceptance.mutate(pending)}
            >
              Retry confirmation
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
            Keep edit and dismiss
          </Button>
        </div>
      ) : null}
      {(comment.aiSuggestions ?? []).map((suggestion) => (
        <section
          key={suggestion.id}
          className={styles.aiSuggestion}
          aria-label="AI evidence suggestion"
        >
          <p className={styles.aiHeading}>
            <Icon name="sparkle" size={16} /> <strong>AI · Evidence suggestion</strong>
          </p>
          <p className={styles.meta}>
            Requested by {suggestion.requestedByName} ·{' '}
            <time dateTime={suggestion.createdAt}>
              {new Date(suggestion.createdAt).toLocaleString()}
            </time>
          </p>
          {suggestion.evidence.generation ? (
            <p className={styles.meta}>
              {suggestion.evidence.generation.model.provider} ·{' '}
              {suggestion.evidence.generation.model.name}
            </p>
          ) : null}
          <blockquote aria-label="Claim researched">{suggestion.claim}</blockquote>
          {available && editor && liveClaim !== suggestion.claim ? (
            <p className={styles.evidenceWarning}>
              Highlighted text changed. Request fresh evidence before citing.
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
                      supporting: 'Supporting evidence',
                      related: 'Related evidence',
                      insufficient: 'Insufficient evidence',
                    }[candidate.category]
                  }
                </strong>
              </p>
              <a href={citationPath(candidate.citation)}>
                {candidate.citation.title || 'Open source'}
                {candidate.citation.pageStart === null
                  ? ''
                  : ` · p. ${candidate.citation.pageStart}`}
              </a>
              <p className={styles.body}>{candidate.reason}</p>
              <details>
                <summary>Source excerpt</summary>
                <blockquote>{candidate.snippet}</blockquote>
              </details>
              {suggestion.acceptedChunkIds.includes(candidate.citation.chunkId) ? (
                <p className={styles.meta}>
                  <Icon name="check" size={14} /> Citation inserted manually
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
                  Insert citation
                </Button>
              ) : null}
            </div>
          ))}
          <p className={styles.meta}>
            Review source evidence before citing. This suggestion leaves the thread open.
          </p>
        </section>
      ))}
    </div>
  );
}
