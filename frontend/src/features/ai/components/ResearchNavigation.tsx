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
      sources.sources.find((source) => source.id === sourceId)?.title ?? 'This source'
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
  return (
    <div className={styles.investigations}>
      <h2>Investigations</h2>
      <Button icon="plus" onClick={() => onChoose(null)}>
        New question
      </Button>
      {loading ? <p role="status">Loading research conversations…</p> : null}
      {error !== null ? (
        <p role="alert">Could not load conversations: {error}</p>
      ) : (
        <>
          {items.length === 0 && !loading ? (
            <p>Your research conversations will appear here.</p>
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
                        <time dateTime={item.updatedAt}>
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </time>
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {hasMore ? (
            <Button variant="ghost" disabled={morePending} onClick={onMore}>
              More conversations
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
  const source = sources.sources.find((item) => item.id === sourceId);
  return (
    <Panel title="Scope">
      <fieldset className={styles.scope} disabled={disabled}>
        <legend>Research scope</legend>
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
              This source
            </label>
          ) : null}
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'selected'}
              onChange={() => onScope('selected')}
            />
            Selected sources
          </label>
          <label>
            <input
              type="radio"
              name="research-scope"
              checked={scope === 'all'}
              onChange={() => onScope('all')}
            />
            All workspace sources
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
            Apply scope
          </Button>
        ) : null}
        <p>Only ready sources can be used as evidence.</p>
      </fieldset>
    </Panel>
  );
}
