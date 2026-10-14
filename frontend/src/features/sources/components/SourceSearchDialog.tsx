import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Dialog } from '../../../shared/components/overlays';
import {
  EmptyState,
  IconTile,
  Keycap,
  KeyboardHintBar,
} from '../../../shared/components/content';
import { Icon } from '../../../shared/components/icons';
import { Illustration } from '../../../shared/components/Illustration';
import {
  searchSourceText,
  passageLocation,
  type SourceTextHit,
} from '../api/sourceTextSearch';
import styles from './SourceSearch.module.css';

/** React text nodes/marks keep source markup inert; matching is literal and case-insensitive. */
export function MatchedText({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): ReactElement {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  return (
    <>
      {text
        .split(pattern)
        .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}
    </>
  );
}

export function SourceSearchDialog({
  workspaceId,
  titles,
  onClose,
  onOpen,
}: {
  readonly workspaceId: string;
  readonly titles: ReadonlyMap<string, string>;
  readonly onClose: () => void;
  readonly onOpen: (hit: SourceTextHit, beside: boolean) => void;
}): ReactElement {
  useUiLocale();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);
  const search = useQuery({
    queryKey: queryKeys.sourceTextSearch(workspaceId, query),
    queryFn: ({ signal }) => searchSourceText(workspaceId, query, signal),
    enabled: query.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
  });
  const settling = input.trim() !== query;
  const hits = !settling && !search.error ? (search.data ?? []) : [];
  const index = Math.max(
    0,
    hits.findIndex((hit) => hit.chunk.chunkId === selectedId),
  );
  const selected = hits[index];
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected?.chunk.chunkId]);
  const clear = (): void => {
    setInput('');
    setQuery('');
    setSelectedId(null);
    inputRef.current?.focus();
  };
  const title = (hit: SourceTextHit): string =>
    titles.get(hit.chunk.sourceId) ?? uiText('ui.SourceCommandSearch.message003');
  const open = (beside: boolean): void => {
    if (selected) onOpen(selected, beside);
  };
  const searching = Boolean(input.trim()) && (settling || search.isFetching);
  return (
    <Dialog
      open
      title={uiText('ui.SourceSearchDialog.message001')}
      onClose={onClose}
      initialFocusRef={inputRef}
      className={styles.dialog}
      description={uiText('ui.SourceSearchDialog.message002')}
      footer={
        <div className={styles.footer}>
          <KeyboardHintBar
            hints={[
              {
                keys: ['↑', '↓'],
                get label() {
                  return uiText('ui.WorkspaceSearchDialog.message003');
                },
              },
              {
                keys: ['Enter'],
                get label() {
                  return uiText('ui.DocumentComments.message003');
                },
              },
              {
                keys: ['Cmd/Ctrl', 'Enter'],
                get label() {
                  return uiText('ui.SourceSearchDialog.message003');
                },
              },
              {
                keys: ['Esc'],
                get label() {
                  return uiText('ui.WorkspaceSearchDialog.message005');
                },
              },
            ]}
          />
          <span>{uiText('ui.SourceSearchDialog.message004')}</span>
        </div>
      }
    >
      <div
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !hits.length) return;
          if (
            event.target !== inputRef.current &&
            !listRef.current?.contains(event.target as Node)
          )
            return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next =
              (index + (event.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
            setSelectedId(hits[next]!.chunk.chunkId);
            inputRef.current?.focus();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(event.metaKey || event.ctrlKey);
          }
        }}
      >
        <div className={styles.searchField}>
          <Icon name="search" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label={uiText('ui.SourceSearchDialog.message001')}
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls={`${id}-results`}
            aria-activedescendant={selected ? `${id}-result-${String(index)}` : undefined}
            placeholder={uiText('ui.SourceSearchDialog.message005')}
            maxLength={2000}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setSelectedId(null);
            }}
          />
          <Keycap>{uiText('ui.SourceSearchDialog.message006')}</Keycap>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className={styles.count}>
          {searching
            ? uiText('ui.SourceSearchDialog.message007')
            : query && !settling && !search.error
              ? uiText('ui.SourceSearchDialog.message008', {
                  value0: String(hits.length),
                  value1:
                    hits.length === 1
                      ? uiText('ui.WorkspaceSearchDialog.message010')
                      : uiText('ui.WorkspaceSearchDialog.message011'),
                })
              : uiText('ui.SourceSearchDialog.message009')}
        </p>
        {search.error && !settling ? (
          <div role="alert">
            {uiText('ui.SourceSearchDialog.message010')} {describeError(search.error)}{' '}
            <Button variant="secondary" onClick={() => void search.refetch()}>
              {uiText('ui.SourceSearchDialog.message011')}
            </Button>
          </div>
        ) : null}
        {query && !settling && !searching && !search.error && hits.length === 0 ? (
          <EmptyState
            size="compact"
            tone="blue"
            title={uiText('ui.WorkspaceSearchDialog.message014', { value0: query })}
            description={uiText('ui.SourceSearchDialog.message012')}
            context={uiText('ui.SourceSearchDialog.message013')}
            art={<Illustration scene="search" size="compact" />}
            actions={[
              <Button
                key="sources"
                icon="search"
                onClick={() => inputRef.current?.focus()}
              >
                {uiText('ui.SourceSearchDialog.message014')}
              </Button>,
              <Button key="clear" variant="secondary" onClick={clear}>
                {uiText('ui.DocumentList.message017')}
              </Button>,
            ]}
          />
        ) : null}
        <div className={styles.columns}>
          <section
            aria-label={uiText('ui.SourceSearchDialog.message015')}
            className={styles.results}
          >
            {hits.length ? (
              <h3>
                <IconTile icon="book" tone="blue" size="small" />
                {uiText('ui.landingContent.message005')} <span>{hits.length}</span>
              </h3>
            ) : null}
            <div
              ref={listRef}
              role="listbox"
              id={`${id}-results`}
              aria-label={uiText('ui.SourceSearchDialog.message016')}
              className={styles.list}
            >
              {hits.map((hit, hitIndex) => (
                <div
                  key={hit.chunk.chunkId}
                  id={`${id}-result-${String(hitIndex)}`}
                  role="option"
                  aria-selected={hitIndex === index}
                  tabIndex={-1}
                  className={styles.row}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedId(hit.chunk.chunkId);
                    inputRef.current?.focus();
                  }}
                  onDoubleClick={() => onOpen(hit, false)}
                >
                  <strong>{title(hit)}</strong>
                  <span className={styles.location}> · {passageLocation(hit)}</span>
                  <p>
                    <MatchedText text={hit.chunk.content.slice(0, 280)} query={query} />
                    {hit.chunk.content.length > 280 ? '…' : ''}
                  </p>
                </div>
              ))}
            </div>
          </section>
          {selected ? (
            <aside
              className={styles.preview}
              aria-label={uiText('ui.SourceSearchDialog.message017')}
            >
              <h3>{uiText('ui.DocumentHistory.message022')}</h3>
              <strong>
                {title(selected)} · {passageLocation(selected)}
              </strong>
              <p className={styles.evidenceType}>
                {uiText('ui.SourceCommandSearch.message003')}
              </p>
              <blockquote>
                <MatchedText text={selected.chunk.content} query={query} />
              </blockquote>
              <Button onClick={(event) => open(event.metaKey || event.ctrlKey)}>
                {uiText('ui.GroundedAnswer.message006')}
              </Button>
            </aside>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
