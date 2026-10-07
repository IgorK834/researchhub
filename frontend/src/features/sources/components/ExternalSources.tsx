import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { Panel, EmptyState } from '../../../shared/components/content';
import { Checkbox, TextField } from '../../../shared/components/forms';
import { Sticker } from '../../../shared/components/identity';
import { describeError, queryKeys } from '../../../shared/api';
import {
  fetchExternalAvailability,
  fetchExternalSources,
  searchExternalSources,
  recordExternalSource,
  type ExternalResult,
} from '../api/externalSourceApi';
import styles from './ExternalSources.module.css';

export function ExternalSources({
  workspaceId,
  canEdit,
}: {
  readonly workspaceId: string;
  readonly canEdit: boolean;
}): ReactElement {
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set());
  const client = useQueryClient();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const availability = useQuery({
    queryKey: [...queryKeys.externalSources(workspaceId), 'availability'],
    queryFn: ({ signal }) => fetchExternalAvailability(workspaceId, signal),
    retry: false,
  });
  const references = useQuery({
    queryKey: [...queryKeys.externalSources(workspaceId), 'page', page],
    queryFn: ({ signal }) => fetchExternalSources(workspaceId, page, signal),
    retry: false,
  });
  const discovery = useMutation({
    mutationFn: (command: { readonly query: string; readonly signal: AbortSignal }) =>
      searchExternalSources(workspaceId, command.query, true, command.signal),
  });
  const save = useMutation({
    mutationFn: (command: { readonly searchId: string; readonly resultId: string }) =>
      recordExternalSource(workspaceId, command.searchId, command.resultId),
    onSuccess: (reference) => {
      setRecorded((previous) => new Set([...previous, reference.resultId]));
      void client.invalidateQueries({ queryKey: queryKeys.externalSources(workspaceId) });
    },
  });
  const currentDiscovery =
    enabled && discovery.data?.workspaceId === workspaceId && !discovery.isPending
      ? discovery.data
      : undefined;
  const disable = (): void => {
    request.current?.abort();
    setEnabled(false);
    discovery.reset();
    save.reset();
  };
  return (
    <section className={styles.page} aria-labelledby="external-sources-heading">
      <header>
        <h1 id="external-sources-heading">External web references</h1>
        <Sticker icon="globe" tone="yellow" label="External web" />
      </header>
      <p>
        Discover web sources separately from your uploaded workspace evidence. A recorded
        reference preserves the search result; it does not import the page or verify its
        claims.
      </p>
      <p>
        <Link to={`/app/workspaces/${workspaceId}/sources`}>Workspace sources only</Link>{' '}
        · AI answers and report citations continue to use imported workspace sources only.
      </p>
      {canEdit ? (
        <Panel title="Discover external sources">
          {availability.isPending ? (
            <p role="status">Checking external search availability…</p>
          ) : availability.error ? (
            <p role="alert">
              Could not check external search: {describeError(availability.error)}{' '}
              <Button variant="secondary" onClick={() => void availability.refetch()}>
                Retry availability
              </Button>
            </p>
          ) : !availability.data.available ? (
            <p role="status">
              External search is not configured on this server. Recorded references remain
              available below.
            </p>
          ) : (
            <>
              <Checkbox
                label="Enable external search"
                checked={enabled}
                onChange={(event) => {
                  if (event.target.checked) setEnabled(true);
                  else disable();
                }}
                hint="Your search query is sent to Brave Search. Uploaded source text is not sent. You can turn this off at any time."
              />
              {enabled ? (
                <form
                  className={styles.search}
                  onSubmit={(event) => {
                    event.preventDefault();
                    request.current?.abort();
                    request.current = new AbortController();
                    setRecorded(new Set());
                    save.reset();
                    discovery.mutate({ query, signal: request.current.signal });
                  }}
                >
                  <TextField
                    label="Search the external web"
                    required
                    maxLength={600}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <Button
                    icon="search"
                    type="submit"
                    disabled={discovery.isPending || !query.trim()}
                  >
                    {discovery.isPending
                      ? 'Searching external web…'
                      : 'Search external web'}
                  </Button>
                </form>
              ) : (
                <p>
                  External search is off. Enable it explicitly to discover web references.
                </p>
              )}
            </>
          )}
          {enabled && discovery.error ? (
            <p role="alert">
              Could not search external sources: {describeError(discovery.error)}
            </p>
          ) : null}
          {enabled && save.error ? (
            <p role="alert">Could not record reference: {describeError(save.error)}</p>
          ) : null}
          {currentDiscovery ? (
            <section aria-label="External discoveries">
              <p role="status">
                {currentDiscovery.results.length} external web results ·{' '}
                {currentDiscovery.provider} ·{' '}
                {new Date(currentDiscovery.searchedAt).toLocaleString()}
              </p>
              {currentDiscovery.results.length === 0 ? (
                <p>No external results. Try a different query.</p>
              ) : (
                <ul className={styles.list}>
                  {currentDiscovery.results.map((result) => (
                    <li key={result.id}>
                      <WebResult result={result} />
                      <Button
                        variant="secondary"
                        disabled={save.isPending || recorded.has(result.id)}
                        onClick={() =>
                          save.mutate({
                            searchId: currentDiscovery.id,
                            resultId: result.id,
                          })
                        }
                      >
                        {recorded.has(result.id)
                          ? 'Reference recorded'
                          : 'Record reference'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </Panel>
      ) : (
        <p>
          You can read recorded references. Discovering or recording external sources
          requires editor access in an active workspace.
        </p>
      )}
      <Panel title="Recorded external references">
        {references.isPending ? (
          <p role="status">Loading recorded references…</p>
        ) : references.error ? (
          <p role="alert">
            Could not load references: {describeError(references.error)}{' '}
            <Button variant="secondary" onClick={() => void references.refetch()}>
              Retry references
            </Button>
          </p>
        ) : (
          <>
            {references.data.items.length === 0 ? (
              <EmptyState
                size="compact"
                title="No external references recorded"
                description="Discover a web source and record its result to retain its origin. Uploaded sources stay in the workspace library."
              />
            ) : (
              <ul className={styles.list}>
                {references.data.items.map((reference) => (
                  <li key={reference.id}>
                    <WebResult result={reference} />
                    <details>
                      <summary>Discovery provenance</summary>
                      <dl>
                        <dt>Provider</dt>
                        <dd>{reference.provider}</dd>
                        <dt>Search query</dt>
                        <dd>{reference.query}</dd>
                        <dt>Discovered</dt>
                        <dd>{new Date(reference.discoveredAt).toLocaleString()}</dd>
                        <dt>Recorded</dt>
                        <dd>{new Date(reference.recordedAt).toLocaleString()}</dd>
                        <dt>Snapshot SHA-256</dt>
                        <dd className={styles.hash}>{reference.snapshotSha256}</dd>
                      </dl>
                    </details>
                    <p>
                      Recorded external reference. To cite this as workspace evidence,
                      upload the original material and review its extracted content.
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <nav
              className={styles.pagination}
              aria-label="Recorded references pagination"
            >
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous references
              </Button>
              <span>
                Page {page + 1} · {references.data.totalElements} references
              </span>
              <Button
                variant="secondary"
                disabled={!references.data.hasNext}
                onClick={() => setPage(page + 1)}
              >
                Next references
              </Button>
            </nav>
          </>
        )}
      </Panel>
    </section>
  );
}

function WebResult({ result }: { readonly result: ExternalResult }): ReactElement {
  return (
    <>
      <Sticker tone="yellow" icon="globe" label="External web" />
      <h3>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          {result.title}
        </a>
      </h3>
      <p className={styles.url}>{result.url}</p>
      <p>{result.snippet || 'No search snippet provided.'}</p>
    </>
  );
}
