import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { EmptyState, KeyboardHintBar } from '../../../shared/components/content';
import { Select } from '../../../shared/components/forms';
import { Icon, type IconName } from '../../../shared/components/icons';
import { Dialog } from '../../../shared/components/overlays';
import {
  searchWorkspace,
  type WorkspaceSearchResult,
  type WorkspaceSearchType,
} from '../api/workspaceSearchApi';
import styles from './WorkspaceSearch.module.css';

const TYPES = ['DOCUMENT', 'SOURCE', 'CONVERSATION', 'COMMENT', 'ANALYSIS'] as const;
const labels: Record<WorkspaceSearchType, string> = {
  DOCUMENT: 'Document',
  SOURCE: 'Source',
  CONVERSATION: 'Conversation',
  COMMENT: 'Comment',
  ANALYSIS: 'Analysis',
};
const icons: Record<WorkspaceSearchType, IconName> = {
  DOCUMENT: 'file',
  SOURCE: 'book',
  CONVERSATION: 'sparkle',
  COMMENT: 'comment',
  ANALYSIS: 'flask',
};

function MatchedText({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): ReactElement {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  if (!terms.length) return <>{text}</>;
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  return (
    <>
      {text
        .split(expression)
        .map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part))}
    </>
  );
}

export function WorkspaceSearchDialog({
  workspaceId,
  returnFocusRef,
  onClose,
  onOpen,
}: {
  readonly workspaceId: string;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onOpen: (path: string, beside?: WorkspaceSearchResult) => void;
}): ReactElement {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<WorkspaceSearchType | 'ALL'>('ALL');
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setCursor(undefined);
      setSelected(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [input, type]);
  const search = useQuery({
    queryKey: queryKeys.workspaceSearch(workspaceId, query, type, cursor),
    queryFn: ({ signal }) =>
      searchWorkspace(workspaceId, query, type === 'ALL' ? [] : [type], cursor, signal),
    enabled: query.length > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const settling = input.trim() !== query;
  const results = !settling && !search.error ? (search.data?.items ?? []) : [];
  const active = results[selected];
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const open = (beside = false): void => {
    if (active) {
      if (beside) onOpen(active.location, active);
      else onOpen(active.location);
    }
  };
  const searching = Boolean(input.trim()) && (settling || search.isFetching);
  return (
    <Dialog
      open
      title="Search workspace"
      description="Documents, sources, conversations, comments, and analyses in this workspace."
      onClose={onClose}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      className={styles.dialog}
      footer={
        <KeyboardHintBar
          hints={[
            { keys: ['↑', '↓'], label: 'move' },
            { keys: ['Enter'], label: 'open' },
            { keys: ['Cmd/Ctrl', 'Enter'], label: 'preview beside' },
            { keys: ['Esc'], label: 'close' },
          ]}
        />
      }
    >
      <div
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !results.length) return;
          if (
            event.target !== inputRef.current &&
            !listRef.current?.contains(event.target as Node)
          )
            return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected(
              (current) =>
                (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
                results.length,
            );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(event.ctrlKey || event.metaKey);
          }
        }}
      >
        <div className={styles.controls}>
          <div className={styles.searchField}>
            <Icon name="search" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search workspace"
              aria-expanded={results.length > 0}
              aria-controls={`${id}-results`}
              aria-activedescendant={
                active ? `${id}-result-${String(selected)}` : undefined
              }
              maxLength={200}
              placeholder="Search research work…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <Select
            label="Result type"
            value={type}
            onChange={(event) => {
              setCursor(undefined);
              setSelected(0);
              setType(event.target.value as WorkspaceSearchType | 'ALL');
            }}
          >
            <option value="ALL">All types</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </Select>
        </div>
        <p role="status" aria-live="polite">
          {searching
            ? 'Searching this workspace…'
            : query && !search.error
              ? `${String(results.length)} ${results.length === 1 ? 'result' : 'results'}`
              : 'Enter a phrase to search this workspace.'}
        </p>
        {search.error && !settling ? (
          <p role="alert">
            Could not search this workspace: {describeError(search.error)}
          </p>
        ) : null}
        {query && !searching && !search.error && results.length === 0 ? (
          <EmptyState
            size="compact"
            tone="blue"
            title={`Nothing matches “${query}”`}
            description="Try fewer words or a different result type."
            context="Workspace search · no results"
          />
        ) : null}
        <div ref={listRef} role="listbox" id={`${id}-results`} className={styles.results}>
          {results.map((result: WorkspaceSearchResult, index) => (
            <div
              key={`${result.type}-${result.id}`}
              id={`${id}-result-${String(index)}`}
              role="option"
              aria-selected={selected === index}
              className={styles.result}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSelected(index)}
              onDoubleClick={() => onOpen(result.location)}
            >
              <Icon name={icons[result.type]} />
              <div>
                <strong>{result.title}</strong>
                <span> · {labels[result.type]}</span>
                <p>
                  <MatchedText text={result.snippet} query={query} />
                </p>
                <small>
                  {result.sourceVersion ? `Version ${result.sourceVersion} · ` : ''}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                    new Date(result.updatedAt),
                  )}
                </small>
              </div>
            </div>
          ))}
        </div>
        {search.data?.nextCursor ? (
          <Button
            variant="secondary"
            disabled={search.isFetching}
            onClick={() => {
              setCursor(search.data?.nextCursor ?? undefined);
              setSelected(0);
            }}
          >
            Next results
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
