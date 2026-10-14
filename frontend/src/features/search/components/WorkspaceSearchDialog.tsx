import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  get DOCUMENT() {
    return uiText('ui.InsertAnalysisResult.message004');
  },
  get SOURCE() {
    return uiText('ui.AiDraftBlock.message007');
  },
  get CONVERSATION() {
    return uiText('ui.ResearchPanel.message010');
  },
  get COMMENT() {
    return uiText('ui.DocumentComments.message015');
  },
  get ANALYSIS() {
    return uiText('ui.AnalysisOutputPicker.message003');
  },
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
  useUiLocale();
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
      title={uiText('ui.WorkspaceSearchDialog.message001')}
      description={uiText('ui.WorkspaceSearchDialog.message002')}
      onClose={onClose}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      className={styles.dialog}
      footer={
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
                return uiText('search.openHint');
              },
            },
            {
              keys: ['Cmd/Ctrl', 'Enter'],
              get label() {
                return uiText('ui.WorkspaceSearchDialog.message004');
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
              aria-label={uiText('ui.WorkspaceSearchDialog.message001')}
              aria-expanded={results.length > 0}
              aria-controls={`${id}-results`}
              aria-activedescendant={
                active ? `${id}-result-${String(selected)}` : undefined
              }
              maxLength={200}
              placeholder={uiText('ui.WorkspaceSearchDialog.message006')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <Select
            label={uiText('ui.WorkspaceSearchDialog.message007')}
            value={type}
            onChange={(event) => {
              setCursor(undefined);
              setSelected(0);
              setType(event.target.value as WorkspaceSearchType | 'ALL');
            }}
          >
            <option value="ALL">{uiText('ui.WorkspaceSearchDialog.message008')}</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </Select>
        </div>
        <p role="status" aria-live="polite">
          {searching
            ? uiText('ui.WorkspaceSearchDialog.message009')
            : query && !search.error
              ? uiText('counts.results', { count: results.length })
              : uiText('ui.WorkspaceSearchDialog.message012')}
        </p>
        {search.error && !settling ? (
          <p role="alert">
            {uiText('ui.WorkspaceSearchDialog.message013')} {describeError(search.error)}
          </p>
        ) : null}
        {query && !searching && !search.error && results.length === 0 ? (
          <EmptyState
            size="compact"
            tone="blue"
            title={uiText('ui.WorkspaceSearchDialog.message014', { value0: query })}
            description={uiText('ui.WorkspaceSearchDialog.message015')}
            context={uiText('ui.WorkspaceSearchDialog.message016')}
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
                  {result.sourceVersion
                    ? uiText('ui.WorkspaceSearchDialog.message017', {
                        value0: result.sourceVersion,
                      }) + ' '
                    : ''}
                  {new Intl.DateTimeFormat(getIntlLocale(), {
                    dateStyle: 'medium',
                  }).format(new Date(result.updatedAt))}
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
            {uiText('ui.WorkspaceSearchDialog.message018')}
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
