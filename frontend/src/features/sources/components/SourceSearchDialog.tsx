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
    titles.get(hit.chunk.sourceId) ?? 'Workspace source';
  const open = (beside: boolean): void => {
    if (selected) onOpen(selected, beside);
  };
  const searching = Boolean(input.trim()) && (settling || search.isFetching);
  return (
    <Dialog
      open
      title="Search source text"
      onClose={onClose}
      initialFocusRef={inputRef}
      className={styles.dialog}
      description="Workspace sources only. Searches passages in the sources you can access."
      footer={
        <div className={styles.footer}>
          <KeyboardHintBar
            hints={[
              { keys: ['↑', '↓'], label: 'move' },
              { keys: ['Enter'], label: 'open' },
              { keys: ['Cmd/Ctrl', 'Enter'], label: 'open beside' },
              { keys: ['Esc'], label: 'close' },
            ]}
          />
          <span>Workspace source text only</span>
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
            aria-label="Search source text"
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls={`${id}-results`}
            aria-activedescendant={selected ? `${id}-result-${String(index)}` : undefined}
            placeholder="Search passages in workspace sources…"
            maxLength={2000}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setSelectedId(null);
            }}
          />
          <Keycap>Esc</Keycap>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className={styles.count}>
          {searching
            ? 'Searching workspace source text…'
            : query && !settling && !search.error
              ? `${String(hits.length)} ${hits.length === 1 ? 'result' : 'results'} in workspace sources`
              : 'Enter a phrase to search your workspace sources.'}
        </p>
        {search.error && !settling ? (
          <div role="alert">
            Could not search source text: {describeError(search.error)}{' '}
            <Button variant="secondary" onClick={() => void search.refetch()}>
              Retry search
            </Button>
          </div>
        ) : null}
        {query && !settling && !searching && !search.error && hits.length === 0 ? (
          <EmptyState
            size="compact"
            tone="blue"
            title={`Nothing matches “${query}”`}
            description="Try fewer words. This search already uses workspace sources only."
            context="Search · no results"
            art={<Illustration scene="search" size="compact" />}
            actions={[
              <Button
                key="sources"
                icon="search"
                onClick={() => inputRef.current?.focus()}
              >
                Search sources only
              </Button>,
              <Button key="clear" variant="secondary" onClick={clear}>
                Clear search
              </Button>,
            ]}
          />
        ) : null}
        <div className={styles.columns}>
          <section aria-label="Sources results" className={styles.results}>
            {hits.length ? (
              <h3>
                <IconTile icon="book" tone="blue" size="small" />
                Sources <span>{hits.length}</span>
              </h3>
            ) : null}
            <div
              ref={listRef}
              role="listbox"
              id={`${id}-results`}
              aria-label="Source passages"
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
            <aside className={styles.preview} aria-label="Selected passage preview">
              <h3>Preview</h3>
              <strong>
                {title(selected)} · {passageLocation(selected)}
              </strong>
              <p className={styles.evidenceType}>Workspace source</p>
              <blockquote>
                <MatchedText text={selected.chunk.content} query={query} />
              </blockquote>
              <Button onClick={(event) => open(event.metaKey || event.ctrlKey)}>
                Open page
              </Button>
            </aside>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
