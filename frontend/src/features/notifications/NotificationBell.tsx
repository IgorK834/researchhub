import { DigestPanel, DigestPreferences } from './DigestPanel';
import { useId, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { SlideOver } from '../../shared/components/overlays/Dialog';
import { describeError } from '../../shared/api';
import { getIntlLocale, t, useLocale } from '../../shared/i18n';
import {
  notificationApi,
  notificationTypes,
  type NotificationType,
} from './notificationApi';
import styles from './Notifications.module.css';

export function NotificationBell({
  userId,
}: {
  readonly userId: string;
  readonly workspaceId?: string;
}): ReactElement {
  useLocale();
  const [open, setOpen] = useState(false),
    [unread, setUnread] = useState(false),
    [type, setType] = useState<NotificationType | ''>('');
  const badgeId = useId();
  const trigger = useRef<HTMLButtonElement>(null),
    client = useQueryClient();
  const root = ['notifications', userId];
  const badge = useQuery({
    queryKey: [...root, 'count'],
    queryFn: () => notificationApi.list(null, false, '', 1),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const feed = useInfiniteQuery({
    queryKey: [...root, 'feed', unread, type],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => notificationApi.list(pageParam, unread, type),
    getNextPageParam: (page) => page.nextCursor,
    enabled: open,
    maxPages: 5,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (action: { id: string } | { before: string }) => {
      if ('id' in action) await notificationApi.read(action.id);
      else await notificationApi.readAll(action.before);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: root }),
  });
  const count = badge.error ? undefined : badge.data?.unreadCount;
  const rows = feed.error ? [] : (feed.data?.pages.flatMap((page) => page.items) ?? []);
  return (
    <>
      <Button
        ref={trigger}
        icon="bell"
        variant="ghost"
        size="compact"
        aria-label={t('collab.notifications')}
        aria-haspopup="dialog"
        aria-describedby={count !== undefined && count > 0 ? badgeId : undefined}
        onClick={() => setOpen(true)}
      >
        {count !== undefined && count > 0 ? (
          <span
            id={badgeId}
            aria-live="polite"
            aria-label={t('collab.unreadCount', { count })}
          >
            {badge.data?.countCapped ? '1000+' : count}
          </span>
        ) : null}
        {badge.error ? <span title={t('collab.notificationError')}>!</span> : null}
      </Button>
      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={trigger}
        title={t('collab.notifications')}
      >
        <DigestPanel />
        <div className={styles.filters}>
          <Button
            variant="ghost"
            disabled={feed.isFetching}
            onClick={() => {
              void client.resetQueries({
                queryKey: [...root, 'feed', unread, type],
                exact: true,
              });
            }}
          >
            {t('collab.newest')}
          </Button>
          <label>
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => setUnread(e.target.checked)}
            />
            {t('collab.unreadOnly')}
          </label>
          <label>
            {t('collab.eventType')}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as NotificationType | '')}
            >
              <option value="">{t('collab.all')}</option>
              {notificationTypes.map((value) => (
                <option key={value} value={value}>
                  {t(`collab.event.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={rows.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate({ before: rows[0]!.createdAt })}
          >
            {t('collab.readAll')}
          </Button>
        </div>
        {feed.isPending ? <p role="status">{t('collab.loading')}</p> : null}
        {feed.error ? (
          <p role="alert">
            {t('collab.notificationError')} {describeError(feed.error)}{' '}
            <Button
              onClick={() => {
                void feed.refetch();
              }}
            >
              {t('common.retry')}
            </Button>
          </p>
        ) : null}
        {mutation.error ? <p role="alert">{describeError(mutation.error)}</p> : null}
        {feed.isSuccess && rows.length === 0 ? (
          <p>{t('collab.noNotifications')}</p>
        ) : null}
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} data-unread={row.readAt === null}>
              <Link
                to={row.href}
                onClick={() => {
                  if (row.readAt === null) mutation.mutate({ id: row.id });
                  setOpen(false);
                }}
              >
                {t(`collab.event.${row.type}`)}
              </Link>
              <p>
                {row.workspaceLabel}
                {row.targetLabel ? ` · ${row.targetLabel}` : ''}
              </p>
              <time dateTime={row.createdAt}>
                {new Date(row.createdAt).toLocaleString(getIntlLocale())}
              </time>
              {row.readAt === null ? (
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: row.id })}
                >
                  {t('collab.read')}
                </Button>
              ) : (
                <span>{t('collab.readDone')}</span>
              )}
            </li>
          ))}
        </ul>
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
        <DigestPreferences />
      </SlideOver>
    </>
  );
}
