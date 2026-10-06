import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { describeError, hasApiErrorCode, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import { commentApi, type DocumentComment } from './commentApi';
import { commentRange, navigateToComment, type CommentAnchor } from './commentAnchor';
import styles from './DocumentComments.module.css';
import { CommentEvidence } from './CommentEvidence';

type Action =
  | { kind: 'create'; anchor: CommentAnchor; body: string }
  | { kind: 'reply'; commentId: string; id: string; body: string }
  | { kind: 'status'; commentId: string; status: DocumentComment['status'] };

export function DocumentComments({
  workspaceId,
  documentId,
  editor,
  canComment,
  saved,
  pendingAnchor,
  onCancel,
  onOpen,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly editor: Editor | null;
  readonly canComment: boolean;
  readonly saved: boolean;
  readonly pendingAnchor: CommentAnchor | null;
  readonly onCancel: () => void;
  readonly onOpen: () => void;
}): ReactElement {
  const client = useQueryClient();
  const key = queryKeys.documentComments(workspaceId, documentId);
  const comments = useQuery({
    queryKey: key,
    queryFn: () => commentApi.list(workspaceId, documentId),
    refetchInterval: 5000,
    retry: false,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const replyAttempt = useRef<{ id: string; body: string; commentId: string } | null>(
    null,
  );
  const composer = useRef<HTMLTextAreaElement>(null);
  const [liveAnchors, setLiveAnchors] = useState<ReadonlySet<string> | null>(null);
  const history = useQuery({
    queryKey: queryKeys.commentThread(workspaceId, documentId, activeId ?? ''),
    queryFn: () => commentApi.thread(workspaceId, documentId, activeId!),
    enabled: activeId !== null && showHistory,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (action: Action) => {
      if (action.kind === 'create')
        return commentApi.create(workspaceId, documentId, action.anchor, action.body);
      if (action.kind === 'reply')
        return commentApi.reply(
          workspaceId,
          documentId,
          action.commentId,
          action.id,
          action.body,
        );
      return commentApi.status(workspaceId, documentId, action.commentId, action.status);
    },
    onSuccess: (updated, action) => {
      client.setQueryData<DocumentComment[]>(key, (previous = []) =>
        [...previous.filter((comment) => comment.id !== updated.id), updated].sort(
          (a, b) => a.createdAt.localeCompare(b.createdAt),
        ),
      );
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({
        queryKey: queryKeys.commentThread(workspaceId, documentId, updated.id),
      });
      setActiveId(updated.id);
      if (action.kind === 'create') {
        setBody('');
        onCancel();
      }
      if (action.kind === 'reply') {
        setReplyBody('');
        setReplyTo(null);
        replyAttempt.current = null;
      }
    },
  });
  const data = comments.data;
  useEffect(() => {
    if (!editor) return;
    const synchronize = (): void => {
      const ids = new Set(
        (data ?? [])
          .filter((comment) => commentRange(editor.state.doc, comment.anchor.id))
          .map((comment) => comment.anchor.id),
      );
      if (pendingAnchor && commentRange(editor.state.doc, pendingAnchor.id))
        ids.add(pendingAnchor.id);
      setLiveAnchors(ids);
      const statuses = new Map(
        (data ?? []).map((comment) => [comment.anchor.id, comment.status.toLowerCase()]),
      );
      if (pendingAnchor) statuses.set(pendingAnchor.id, 'pending');
      editor.view.dom
        .querySelectorAll<HTMLElement>('[data-comment-anchor]')
        .forEach((element) => {
          const ids = element.dataset['commentAnchor']!.split(' ');
          element.dataset['commentStatus'] =
            ids
              .map((id) => statuses.get(id))
              .find((status) => status === 'pending' || status === 'open') ??
            ids.map((id) => statuses.get(id)).find(Boolean) ??
            '';
          element.dataset['commentActive'] = String(
            data?.some(
              (comment) => comment.id === activeId && ids.includes(comment.anchor.id),
            ) ?? false,
          );
        });
    };
    synchronize();
    editor.on('transaction', synchronize);
    const openThread = (event: MouseEvent): void => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-comment-anchor]')
          : null;
      const comment = data?.find((value) =>
        target?.dataset['commentAnchor']?.split(' ').includes(value.anchor.id),
      );
      if (comment) {
        setActiveId(comment.id);
        setShowResolved(comment.status === 'RESOLVED');
        onOpen();
      }
    };
    editor.view.dom.addEventListener('click', openThread);
    return () => {
      editor.off('transaction', synchronize);
      editor.view.dom.removeEventListener('click', openThread);
    };
  }, [editor, data, activeId, pendingAnchor, onOpen]);
  useEffect(() => {
    if (pendingAnchor) {
      composer.current?.focus();
    }
  }, [pendingAnchor]);

  const noAccess = [comments.error, mutation.error].some(
    (error) =>
      hasApiErrorCode(error, 'FORBIDDEN') || hasApiErrorCode(error, 'RESOURCE_NOT_FOUND'),
  );
  const writable = canComment && !noAccess;
  const available = (comment: DocumentComment): boolean =>
    liveAnchors === null ? !comment.orphaned : liveAnchors.has(comment.anchor.id);
  const resolved = data?.filter((comment) => comment.status === 'RESOLVED') ?? [];
  const opened = data?.filter((comment) => comment.status === 'OPEN') ?? [];
  const rows = showResolved ? resolved : opened;
  return (
    <section aria-label="Document comments" className={styles.panel}>
      <div className={styles.header}>
        <h2>
          Comments <span>{opened.length} open</span>
        </h2>
        <Button
          variant="ghost"
          icon="refresh"
          size="compact"
          onClick={() => {
            void comments.refetch();
          }}
        >
          Refresh comments
        </Button>
      </div>
      {comments.isPending ? <p role="status">Loading comments…</p> : null}
      {comments.error ? (
        <p role="alert">Could not load comments: {describeError(comments.error)}</p>
      ) : null}
      {mutation.error ? (
        <p role="alert">
          Could not save comment: {describeError(mutation.error)} Your draft is kept here.
        </p>
      ) : null}
      {!writable ? (
        <p className={styles.hint}>
          Read-only comments. Only editors and owners can add comments or change threads.
        </p>
      ) : null}
      {pendingAnchor && writable ? (
        <div className={styles.composer}>
          <h3>New comment on selection</h3>
          <blockquote>{pendingAnchor.quote}</blockquote>
          <label className="visually-hidden" htmlFor="comment-body">
            Write a comment
          </label>
          <textarea
            ref={composer}
            id="comment-body"
            rows={4}
            maxLength={4000}
            value={body}
            placeholder="Write a comment…"
            disabled={mutation.isPending}
            onChange={(event) => {
              setBody(event.target.value);
              mutation.reset();
            }}
          />
          {!saved ? (
            <p role="status">Waiting for the selected text to be saved…</p>
          ) : null}
          {liveAnchors !== null && !liveAnchors.has(pendingAnchor.id) ? (
            <p role="status">
              Selected text was removed. Select another passage to comment.
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => {
                setBody('');
                mutation.reset();
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button
              icon="comment"
              disabled={!body.trim() || !saved || !liveAnchors?.has(pendingAnchor.id)}
              busy={mutation.isPending}
              onClick={() =>
                mutation.mutate({ kind: 'create', anchor: pendingAnchor, body })
              }
            >
              Comment
            </Button>
          </div>
        </div>
      ) : writable ? (
        <p className={styles.hint}>
          Select text in the document, then choose Add comment.
        </p>
      ) : null}
      <div className={styles.filters} role="group" aria-label="Comment status">
        <Button
          variant="ghost"
          aria-pressed={!showResolved}
          onClick={() => setShowResolved(false)}
        >
          Open ({opened.length})
        </Button>
        <Button
          variant="ghost"
          aria-pressed={showResolved}
          onClick={() => setShowResolved(true)}
        >
          Resolved ({resolved.length})
        </Button>
      </div>
      {comments.isSuccess && rows.length === 0 ? (
        <p className={styles.hint}>
          {showResolved ? 'No resolved threads.' : 'No open comments yet.'}
        </p>
      ) : null}
      {rows.map((comment) => (
        <article
          key={comment.id}
          aria-label={`Comment by ${comment.authorName}`}
          className={styles.thread}
          data-status={comment.status.toLowerCase()}
          data-active={activeId === comment.id}
        >
          <button
            className={styles.anchor}
            type="button"
            disabled={!available(comment) || !editor}
            aria-label={`Go to commented text: ${comment.anchor.quote}`}
            onClick={() => {
              setActiveId(comment.id);
              navigateToComment(editor!, comment.anchor.id);
            }}
          >
            <blockquote>{comment.anchor.quote}</blockquote>
          </button>
          {!available(comment) ? (
            <p className={styles.orphan}>
              <Icon name="link" size={14} /> Original passage is no longer available. This
              thread is preserved.
            </p>
          ) : null}
          <Contribution
            name={comment.authorName}
            date={comment.createdAt}
            body={comment.body}
          />
          {comment.replies.map((reply) => (
            <Contribution
              key={reply.id}
              name={reply.authorName}
              date={reply.createdAt}
              body={reply.body}
            />
          ))}
          {comment.status === 'RESOLVED' ? (
            <p className={styles.meta}>
              <Icon name="check" size={14} /> Resolved{' '}
              {comment.resolvedAt ? (
                <time dateTime={comment.resolvedAt}>
                  {formatDate(comment.resolvedAt)}
                </time>
              ) : null}
            </p>
          ) : null}
          <div className={styles.actions}>
            {writable && comment.status === 'OPEN' ? (
              <Button
                variant="ghost"
                size="compact"
                disabled={mutation.isPending}
                onClick={() => {
                  setReplyTo(comment.id);
                  setReplyBody('');
                  mutation.reset();
                }}
              >
                Reply
              </Button>
            ) : null}
            {writable ? (
              <Button
                variant="ghost"
                size="compact"
                icon={comment.status === 'OPEN' ? 'check' : 'refresh'}
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    kind: 'status',
                    commentId: comment.id,
                    status: comment.status === 'OPEN' ? 'RESOLVED' : 'OPEN',
                  })
                }
              >
                {comment.status === 'OPEN' ? 'Resolve' : 'Reopen'}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="compact"
              icon="history"
              onClick={() => {
                setActiveId(comment.id);
                setShowHistory(!(activeId === comment.id && showHistory));
              }}
            >
              Activity
            </Button>
          </div>
          {replyTo === comment.id && writable && comment.status === 'OPEN' ? (
            <div className={styles.reply}>
              <label htmlFor={`reply-${comment.id}`}>Reply to {comment.authorName}</label>
              <textarea
                id={`reply-${comment.id}`}
                autoFocus
                rows={3}
                maxLength={4000}
                value={replyBody}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setReplyBody(event.target.value);
                  mutation.reset();
                }}
              />
              <div className={styles.actions}>
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setReplyTo(null);
                    mutation.reset();
                  }}
                >
                  Cancel reply
                </Button>
                <Button
                  disabled={!replyBody.trim()}
                  busy={mutation.isPending}
                  onClick={() => {
                    const previous = replyAttempt.current;
                    const id =
                      previous?.body === replyBody && previous.commentId === comment.id
                        ? previous.id
                        : crypto.randomUUID();
                    replyAttempt.current = { id, body: replyBody, commentId: comment.id };
                    mutation.mutate({
                      kind: 'reply',
                      commentId: comment.id,
                      id,
                      body: replyBody,
                    });
                  }}
                >
                  Send reply
                </Button>
              </div>
            </div>
          ) : null}
          <CommentEvidence
            workspaceId={workspaceId}
            documentId={documentId}
            comment={comment}
            editor={editor}
            writable={writable}
            available={available(comment)}
            saved={saved}
            onUpdated={(updated) => {
              client.setQueryData<DocumentComment[]>(key, (previous = []) =>
                previous.map((row) => (row.id === updated.id ? updated : row)),
              );
              void client.invalidateQueries({ queryKey: key });
              setActiveId(updated.id);
            }}
          />
          {activeId === comment.id && showHistory ? (
            <div className={styles.activity} aria-label="Comment activity">
              {history.isPending ? <p role="status">Loading activity…</p> : null}
              {history.error ? (
                <p role="alert">
                  Could not load activity: {describeError(history.error)}
                </p>
              ) : null}
              <ol>
                {history.data?.events.map((event) => (
                  <li key={event.id}>
                    {event.actorName}{' '}
                    {
                      {
                        CREATED: 'commented',
                        REPLIED: 'replied',
                        RESOLVED: 'resolved the thread',
                        REOPENED: 'reopened the thread',
                      }[event.action]
                    }{' '}
                    ·{' '}
                    <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
function Contribution({
  name,
  date,
  body,
}: {
  readonly name: string;
  readonly date: string;
  readonly body: string;
}): ReactElement {
  return (
    <div className={styles.contribution}>
      <span aria-hidden="true" className={styles.avatar}>
        {name
          .split(/\s+/)
          .map((part) => part[0])
          .slice(0, 2)
          .join('')}
      </span>
      <div>
        <p className={styles.meta}>
          <strong>{name}</strong> <time dateTime={date}>{formatDate(date)}</time>
        </p>
        <p className={styles.body}>{body}</p>
      </div>
    </div>
  );
}
