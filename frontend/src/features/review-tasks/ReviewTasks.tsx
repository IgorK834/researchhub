import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { describeError } from '../../shared/api';
import { getIntlLocale, t, useLocale } from '../../shared/i18n';
import { useDocumentsQuery } from '../documents/api/useDocuments';
import { useAnalysesQuery } from '../analysis/api/useAnalyses';
import { reviewTaskApi, type TaskFilter, type ReviewTask } from './reviewTaskApi';
import { CreateReviewTaskButton, TaskComposer } from './TaskComposer';
import styles from './ReviewTasks.module.css';

export function ReviewTasks({
  workspaceId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly canEdit: boolean;
}): ReactElement {
  useLocale();
  const [filter, setFilter] = useState<TaskFilter>('ALL'),
    [editing, setEditing] = useState<string | null>(null);
  const [params] = useSearchParams(),
    selected = params.get('task'),
    client = useQueryClient();
  const feed = useInfiniteQuery({
    queryKey: ['review-tasks', workspaceId, filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => reviewTaskApi.list(workspaceId, filter, pageParam),
    getNextPageParam: (p) => p.nextCursor,
    maxPages: 5,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const focus = useQuery({
    queryKey: ['review-tasks', workspaceId, 'task', selected],
    queryFn: () => reviewTaskApi.get(workspaceId, selected!),
    enabled: selected !== null,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (task: ReviewTask) =>
      reviewTaskApi.update(workspaceId, task, task, 'DONE'),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['review-tasks', workspaceId] }),
  });
  const rows = feed.error ? [] : (feed.data?.pages.flatMap((p) => p.items) ?? []);
  const visible =
    filter === 'ALL' &&
    focus.data &&
    !focus.error &&
    !feed.error &&
    !rows.some((r) => r.id === focus.data.id)
      ? [focus.data, ...rows]
      : rows;
  return (
    <section className={styles.page}>
      <h1>{t('collab.reviewTasks')}</h1>
      <Button
        variant="ghost"
        disabled={feed.isFetching}
        onClick={() => {
          void client.resetQueries({
            queryKey: ['review-tasks', workspaceId, filter],
            exact: true,
          });
        }}
      >
        {t('collab.newest')}
      </Button>
      <div role="group" aria-label={t('collab.taskFilter')} className={styles.filters}>
        {(['ALL', 'MINE', 'OPEN', 'OVERDUE'] as const).map((f) => (
          <Button
            key={f}
            variant="ghost"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`collab.filter.${f}`)}
          </Button>
        ))}
      </div>
      {canEdit ? <CreateTarget workspaceId={workspaceId} /> : null}
      {feed.isPending || (selected !== null && focus.isPending) ? (
        <p role="status">{t('collab.loading')}</p>
      ) : null}
      {feed.error || focus.error ? (
        <p role="alert">
          {describeError(feed.error ?? focus.error)}{' '}
          <Button
            onClick={() => {
              void feed.refetch();
              void focus.refetch();
            }}
          >
            {t('common.retry')}
          </Button>
        </p>
      ) : null}
      {mutation.error ? <p role="alert">{describeError(mutation.error)}</p> : null}
      {feed.isSuccess && visible.length === 0 ? <p>{t('collab.noTasks')}</p> : null}
      {visible.map((task) => (
        <article
          key={task.id}
          id={`review-task-${task.id}`}
          tabIndex={-1}
          className={styles.card}
        >
          <h2>{task.title}</h2>
          <p>{task.description}</p>
          <p>
            {t(`collab.status.${task.status}`)} ·{' '}
            {task.assignee
              ? task.assigneeLabel
              : task.unassignedReason === 'MEMBER_REMOVED'
                ? t('collab.removedAssignee')
                : t('collab.unassigned')}
          </p>
          {task.dueAt ? (
            <time dateTime={task.dueAt}>
              {new Date(task.dueAt).toLocaleString(getIntlLocale())}
            </time>
          ) : null}
          <Link to={task.href}>{t('collab.openTarget')}</Link>
          {canEdit ? (
            <div className={styles.filters}>
              <Button
                variant="ghost"
                onClick={() => setEditing(editing === task.id ? null : task.id)}
              >
                {t('collab.editTask')}
              </Button>
              {task.status === 'OPEN' || task.status === 'IN_PROGRESS' ? (
                <Button
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(task)}
                >
                  {t('collab.completeTask')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {editing === task.id && canEdit ? (
            <TaskComposer
              key={`${task.id}-${task.revision}`}
              workspaceId={workspaceId}
              target={task}
              task={task}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </article>
      ))}
      {feed.hasNextPage ? (
        <Button
          busy={feed.isFetchingNextPage}
          onClick={() => {
            void feed.fetchNextPage();
          }}
        >
          {t('collab.more')}
        </Button>
      ) : null}
    </section>
  );
}
function CreateTarget({ workspaceId }: { readonly workspaceId: string }): ReactElement {
  const [type, setType] = useState<'DOCUMENT' | 'ANALYSIS'>('DOCUMENT'),
    [target, setTarget] = useState('');
  const documents = useDocumentsQuery(workspaceId),
    analyses = useAnalysesQuery(workspaceId);
  const data = type === 'DOCUMENT' ? documents : analyses;
  const options =
    type === 'DOCUMENT'
      ? documents.data?.map((d) => ({ id: d.id, label: d.title }))
      : analyses.data?.map((a) => ({
          id: a.id,
          label: `${t('collab.analysis')} · ${a.createdAt}`,
        }));
  return (
    <div className={styles.filters}>
      <label>
        {t('collab.targetType')}
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as 'DOCUMENT' | 'ANALYSIS');
            setTarget('');
          }}
        >
          <option value="DOCUMENT">{t('collab.document')}</option>
          <option value="ANALYSIS">{t('collab.analysis')}</option>
        </select>
      </label>
      <label>
        {t('collab.target')}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('collab.chooseTarget')}</option>
          {data.error
            ? null
            : options?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
        </select>
      </label>
      {data.isPending ? <p role="status">{t('collab.loading')}</p> : null}
      {data.error ? <p role="alert">{describeError(data.error)}</p> : null}
      {target && !data.error ? (
        <CreateReviewTaskButton
          workspaceId={workspaceId}
          target={{ targetType: type, targetId: target }}
        />
      ) : null}
    </div>
  );
}
