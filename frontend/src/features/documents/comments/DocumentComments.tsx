import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  initialCommentId,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly editor: Editor | null;
  readonly canComment: boolean;
  readonly saved: boolean;
  readonly pendingAnchor: CommentAnchor | null;
  readonly onCancel: () => void;
  readonly onOpen: () => void;
  readonly initialCommentId?: string;
}): ReactElement {
  useUiLocale();
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
  const [appliedLink, setAppliedLink] = useState<string | null>(null);
  const linkedComment = data?.find((row) => row.id === initialCommentId);
  const linkTarget = initialCommentId ?? null;
  if (appliedLink !== linkTarget && (linkTarget === null || linkedComment)) {
    setAppliedLink(linkTarget);
    if (linkedComment) {
      setActiveId(linkedComment.id);
      setShowResolved(linkedComment.status === 'RESOLVED');
    }
  }
  const linkedId = linkedComment?.id;
  useEffect(() => {
    if (linkedId)
      window.document
        .getElementById(`comment-${linkedId}`)
        ?.scrollIntoView?.({ block: 'nearest' });
  }, [linkedId]);
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
    <section
      aria-label={uiText('ui.DocumentComments.message001')}
      className={styles.panel}
    >
      <div className={styles.header}>
        <h2>
          {uiText('ui.DocumentComments.message002')}{' '}
          <span>
            {opened.length} {uiText('ui.DocumentComments.message003')}
          </span>
        </h2>
        <Button
          variant="ghost"
          icon="refresh"
          size="compact"
          onClick={() => {
            void comments.refetch();
          }}
        >
          {uiText('ui.DocumentComments.message004')}
        </Button>
      </div>
      {comments.isPending ? (
        <p role="status">{uiText('ui.DocumentComments.message005')}</p>
      ) : null}
      {comments.error ? (
        <p role="alert">
          {uiText('ui.DocumentComments.message006')} {describeError(comments.error)}
        </p>
      ) : null}
      {mutation.error ? (
        <p role="alert">
          {uiText('ui.DocumentComments.message007')} {describeError(mutation.error)}{' '}
          {uiText('ui.DocumentComments.message008')}
        </p>
      ) : null}
      {!writable ? (
        <p className={styles.hint}>{uiText('ui.DocumentComments.message009')}</p>
      ) : null}
      {pendingAnchor && writable ? (
        <div className={styles.composer}>
          <h3>{uiText('ui.DocumentComments.message010')}</h3>
          <blockquote>{pendingAnchor.quote}</blockquote>
          <label className="visually-hidden" htmlFor="comment-body">
            {uiText('ui.DocumentComments.message011')}
          </label>
          <textarea
            ref={composer}
            id="comment-body"
            rows={4}
            maxLength={4000}
            value={body}
            placeholder={uiText('ui.DocumentComments.message012')}
            disabled={mutation.isPending}
            onChange={(event) => {
              setBody(event.target.value);
              mutation.reset();
            }}
          />
          {!saved ? (
            <p role="status">{uiText('ui.DocumentComments.message013')}</p>
          ) : null}
          {liveAnchors !== null && !liveAnchors.has(pendingAnchor.id) ? (
            <p role="status">{uiText('ui.DocumentComments.message014')}</p>
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
              {uiText('ui.InsertAnalysisResult.message019')}
            </Button>
            <Button
              icon="comment"
              disabled={!body.trim() || !saved || !liveAnchors?.has(pendingAnchor.id)}
              busy={mutation.isPending}
              onClick={() =>
                mutation.mutate({ kind: 'create', anchor: pendingAnchor, body })
              }
            >
              {uiText('ui.DocumentComments.message015')}
            </Button>
          </div>
        </div>
      ) : writable ? (
        <p className={styles.hint}>{uiText('ui.DocumentComments.message016')}</p>
      ) : null}
      <div
        className={styles.filters}
        role="group"
        aria-label={uiText('ui.DocumentComments.message017')}
      >
        <Button
          variant="ghost"
          aria-pressed={!showResolved}
          onClick={() => setShowResolved(false)}
        >
          {uiText('ui.DocumentComments.message018')}
          {opened.length})
        </Button>
        <Button
          variant="ghost"
          aria-pressed={showResolved}
          onClick={() => setShowResolved(true)}
        >
          {uiText('ui.DocumentComments.message019')}
          {resolved.length})
        </Button>
      </div>
      {comments.isSuccess && rows.length === 0 ? (
        <p className={styles.hint}>
          {showResolved
            ? uiText('ui.DocumentComments.message020')
            : uiText('ui.DocumentComments.message021')}
        </p>
      ) : null}
      {rows.map((comment) => (
        <article
          key={comment.id}
          id={`comment-${comment.id}`}
          aria-label={uiText('ui.DocumentComments.message022', {
            value0: comment.authorName,
          })}
          className={styles.thread}
          data-status={comment.status.toLowerCase()}
          data-active={activeId === comment.id}
        >
          <button
            className={styles.anchor}
            type="button"
            disabled={!available(comment) || !editor}
            aria-label={uiText('ui.DocumentComments.message023', {
              value0: comment.anchor.quote,
            })}
            onClick={() => {
              setActiveId(comment.id);
              navigateToComment(editor!, comment.anchor.id);
            }}
          >
            <blockquote>{comment.anchor.quote}</blockquote>
          </button>
          {!available(comment) ? (
            <p className={styles.orphan}>
              <Icon name="link" size={14} /> {uiText('ui.DocumentComments.message024')}
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
              <Icon name="check" size={14} /> {uiText('ui.DocumentComments.message025')}{' '}
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
                {uiText('ui.DocumentComments.message026')}
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
                {comment.status === 'OPEN'
                  ? uiText('ui.DocumentComments.message027')
                  : uiText('ui.DocumentComments.message028')}
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
              {uiText('ui.DocumentComments.message029')}
            </Button>
          </div>
          {replyTo === comment.id && writable && comment.status === 'OPEN' ? (
            <div className={styles.reply}>
              <label htmlFor={`reply-${comment.id}`}>
                {uiText('ui.DocumentComments.message030')} {comment.authorName}
              </label>
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
                  {uiText('ui.DocumentComments.message031')}
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
                  {uiText('ui.DocumentComments.message032')}
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
            <div
              className={styles.activity}
              aria-label={uiText('ui.DocumentComments.message033')}
            >
              {history.isPending ? (
                <p role="status">{uiText('ui.DocumentComments.message034')}</p>
              ) : null}
              {history.error ? (
                <p role="alert">
                  {uiText('ui.DocumentComments.message035')}{' '}
                  {describeError(history.error)}
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
                        get RESOLVED() {
                          return uiText('ui.DocumentComments.message036');
                        },
                        get REOPENED() {
                          return uiText('ui.DocumentComments.message037');
                        },
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
  return new Date(value).toLocaleString(getIntlLocale(), {
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
