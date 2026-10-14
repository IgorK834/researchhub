import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Button } from '../../../shared/components/Button';
import { ListRow, Panel } from '../../../shared/components/content';
import { SourcePicker } from './SourcePicker';
import type { Conversation } from '../api/conversationApi';
import type { ResearchSources } from './ResearchPanel';
import styles from './Research.module.css';

export type ResearchScope = 'all' | 'selected' | 'source';
export function scopeLabel(
  scope: ResearchScope,
  selected: readonly string[],
  sources: ResearchSources,
  sourceId?: string,
): string {
  if (scope === 'all')
    return `All workspace sources · ${String(sources.sources.filter((source) => source.ready).length)} ready`;
  if (scope === 'source')
    return (
      sources.sources.find((source) => source.id === sourceId)?.title ??
      uiText('ui.ResearchNavigation.message001')
    );
  return `Selected sources · ${String(selected.length)}`;
}
export function conversationRecency(
  timestamp: string,
  now = new Date(),
): 'Today' | 'Yesterday' | 'Earlier' {
  const time = new Date(timestamp).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  ).getTime();
  return time >= today ? 'Today' : time >= yesterday ? 'Yesterday' : 'Earlier';
}
export function Investigations({
  items,
  current,
  onChoose,
  loading,
  error,
  hasMore,
  morePending,
  onMore,
}: {
  readonly items: readonly Conversation[];
  readonly current: string | null;
  readonly onChoose: (id: string | null) => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly morePending: boolean;
  readonly onMore: () => void;
}): ReactElement {
  useUiLocale();
  return (
    <div className={styles.investigations}>
      <h2>{uiText('ui.ResearchNavigation.message002')}</h2>
      <Button icon="plus" onClick={() => onChoose(null)}>
        {uiText('ui.ResearchNavigation.message003')}
      </Button>
      {loading ? <p role="status">{uiText('ui.ResearchNavigation.message004')}</p> : null}
      {error !== null ? (
        <p role="alert">
          {uiText('ui.ResearchNavigation.message005')} {error}
        </p>
      ) : (
        <>
          {items.length === 0 && !loading ? (
            <p>{uiText('ui.ResearchNavigation.message006')}</p>
          ) : null}
          {(['Today', 'Yesterday', 'Earlier'] as const).map((group) => {
            const conversations = items.filter(
              (item) => conversationRecency(item.updatedAt) === group,
            );
            return conversations.length === 0 ? null : (
              <section key={group} aria-label={group}>
                <h3>{group}</h3>
                <ul>
                  {conversations.map((item) => (
                    <ListRow
                      key={item.id}
                      selected={item.id === current}
                      title={
                        <button
                          type="button"
                          aria-current={item.id === current ? 'true' : undefined}
                          onClick={() => onChoose(item.id)}
                        >
                          {item.title}
                        </button>
                      }
                      meta={
                        <>
                          {item.origin ? (
                            <span>
                              {uiText('ui.ResearchNavigation.message007')}{' '}
                              {item.origin.documentTitle} ·{' '}
                            </span>
                          ) : null}
                          <time dateTime={item.updatedAt}>
                            {new Date(item.updatedAt).toLocaleDateString(getIntlLocale())}
                          </time>
                        </>
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {hasMore ? (
            <Button variant="ghost" disabled={morePending} onClick={onMore}>
              {uiText('ui.ResearchNavigation.message008')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
export function ResearchScopePanel({
  sources,
  scope,
  selected,
  sourceId,
  disabled,
  onScope,
  onSelected,
  onApply,
  canApply,
}: {
  readonly sources: ResearchSources;
  readonly scope: ResearchScope;
  readonly selected: readonly string[];
  readonly sourceId?: string;
  readonly disabled: boolean;
  readonly onScope: (scope: ResearchScope, ids?: readonly string[]) => void;
  readonly onSelected: (ids: readonly string[]) => void;
  readonly onApply: () => void;
  readonly canApply: boolean;
}): ReactElement {
  useUiLocale();
  const source = sources.sources.find((item) => item.id === sourceId);
  return (
    <Panel title={uiText('ui.ResearchNavigation.message009')}>
      <fieldset className={styles.scope} disabled={disabled}>
        <legend>{uiText('ui.ResearchNavigation.message010')}</legend>
        <div className={styles.scopeOptions}>
          {sourceId !== undefined ? (
            <label>
              <input
                type="radio"
                name="research-scope"
                checked={scope === 'source'}
                disabled={!source?.ready}
                onChange={() => onScope('source')}
              />
              {uiText('ui.ResearchNavigation.message001')}
            </label>
          ) : null}
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'selected'}
              onChange={() => onScope('selected')}
            />
            {uiText('ui.ResearchNavigation.message011')}
          </label>
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'all'}
              onChange={() => onScope('all')}
            />
            {uiText('ui.ResearchNavigation.message012')}
          </label>
        </div>
        <SourcePicker
          sources={sources.sources.map((item) => ({
            id: item.id,
            title: item.title,
            sourceType: item.sourceType,
            status: item.status ?? (item.ready ? 'READY' : 'PROCESSING'),
          }))}
          value={scope === 'all' ? null : selected}
          disabled={scope === 'source'}
          onChange={(ids) => {
            onSelected(ids);
            if (scope === 'all') onScope('selected', ids);
          }}
        />
        {scope === 'selected' && canApply ? (
          <Button variant="secondary" size="compact" onClick={onApply}>
            {uiText('ui.ResearchNavigation.message013')}
          </Button>
        ) : null}
        <p>{uiText('ui.ResearchNavigation.message014')}</p>
      </fieldset>
    </Panel>
  );
}
