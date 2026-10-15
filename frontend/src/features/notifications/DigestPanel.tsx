import styles from './Notifications.module.css';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { describeError } from '../../shared/api';
import { t, useLocale, getIntlLocale } from '../../shared/i18n';
import {
  digestApi,
  type DigestItem,
  type DigestSettings,
  type Frequency,
} from './digestApi';
import { notificationTypes } from './notificationApi';

function Items({ items }: { readonly items: DigestItem[] }): ReactElement {
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.workspaceId}-${item.category}`}>
          <Link to={item.href}>
            {t(`collab.event.${item.category}`)}: {item.count}
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function DigestPanel(): ReactElement {
  useLocale();
  const client = useQueryClient();
  const feed = useQuery({ queryKey: ['digest'], queryFn: digestApi.feed, retry: false });
  const seen = useMutation({
    mutationFn: (through: string) => digestApi.seen(through),
    onSuccess: () => client.invalidateQueries({ queryKey: ['digest'] }),
  });
  return (
    <section className={styles.digest} aria-label={t('digest.title')}>
      <h2>{t('digest.title')}</h2>
      {feed.isPending ? <p role="status">{t('collab.loading')}</p> : null}
      {feed.error || seen.error ? (
        <p role="alert">{describeError(feed.error ?? seen.error)}</p>
      ) : null}
      {feed.data && !feed.error ? (
        <>
          <p>
            {t('digest.since')}{' '}
            <time>{new Date(feed.data.since).toLocaleString(getIntlLocale())}</time>
          </p>
          {feed.data.sinceLastSeen.length ? (
            <Items items={feed.data.sinceLastSeen} />
          ) : (
            <p>{t('digest.empty')}</p>
          )}
          <Button busy={seen.isPending} onClick={() => seen.mutate(feed.data!.through)}>
            {t('digest.seen')}
          </Button>
          {feed.data.truncated ? <p>{t('digest.bounded')}</p> : null}
          {feed.data.digests.map((d) => (
            <details key={d.id}>
              <summary>
                {t(`digest.${d.frequency}`)} ·{' '}
                {new Date(d.windowStart).toLocaleDateString(getIntlLocale())}
              </summary>
              <Items items={d.items} />
            </details>
          ))}
        </>
      ) : null}
    </section>
  );
}
export function DigestPreferences(): ReactElement {
  useLocale();
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ['digest-preferences'],
    queryFn: digestApi.preferences,
    retry: false,
  });
  const save = useMutation({
    mutationFn: ({
      workspace,
      settings,
    }: {
      workspace: string;
      settings: DigestSettings;
    }) => digestApi.save(workspace, settings),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['digest-preferences'] });
      await client.invalidateQueries({ queryKey: ['digest'] });
    },
  });
  return (
    <section className={styles.digest}>
      <h2>{t('digest.settings')}</h2>
      <p>{t('digest.policy')}</p>
      {preferences.isPending ? <p role="status">{t('collab.loading')}</p> : null}
      {preferences.error || save.error ? (
        <p role="alert">{describeError(preferences.error ?? save.error)}</p>
      ) : null}
      {(!preferences.error ? preferences.data : undefined)?.map((p) => (
        <fieldset
          className={styles.settings}
          key={p.workspaceId}
          disabled={save.isPending}
        >
          <legend>
            {t('digest.workspace')} {p.workspaceId}
          </legend>
          {p.sessionLocal ? <p>{t('digest.session')}</p> : null}
          <label>
            {t('digest.frequency')}
            <select
              value={p.settings.frequency}
              onChange={(e) =>
                save.mutate({
                  workspace: p.workspaceId,
                  settings: { ...p.settings, frequency: e.target.value as Frequency },
                })
              }
            >
              {(['DAILY', 'WEEKLY', 'MUTED'] as const).map((f) => (
                <option value={f} key={f}>
                  {t(`digest.${f}`)}
                </option>
              ))}
            </select>
          </label>
          {notificationTypes.map((type) => (
            <label className={styles.preference} key={type}>
              <input
                type="checkbox"
                checked={p.settings.mutedCategories.includes(type)}
                onChange={(e) =>
                  save.mutate({
                    workspace: p.workspaceId,
                    settings: {
                      ...p.settings,
                      mutedCategories: e.target.checked
                        ? [...p.settings.mutedCategories, type]
                        : p.settings.mutedCategories.filter((v) => v !== type),
                    },
                  })
                }
              />
              {t(`collab.event.${type}`)}
            </label>
          ))}
          <Button
            onClick={() =>
              save.mutate({
                workspace: p.workspaceId,
                settings: { frequency: 'DAILY', mutedCategories: [] },
              })
            }
          >
            {t('digest.restore')}
          </Button>
        </fieldset>
      ))}
    </section>
  );
}
