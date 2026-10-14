import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
        <h1 id="external-sources-heading">{uiText('ui.ExternalSources.message001')}</h1>
        <Sticker
          icon="globe"
          tone="yellow"
          label={uiText('ui.ExternalSources.message002')}
        />
      </header>
      <p>{uiText('ui.ExternalSources.message003')}</p>
      <p>
        <Link to={`/app/workspaces/${workspaceId}/sources`}>
          {uiText('ui.ExternalSources.message004')}
        </Link>{' '}
        {uiText('ui.ExternalSources.message005')}
      </p>
      {canEdit ? (
        <Panel title={uiText('ui.ExternalSources.message006')}>
          {availability.isPending ? (
            <p role="status">{uiText('ui.ExternalSources.message007')}</p>
          ) : availability.error ? (
            <p role="alert">
              {uiText('ui.ExternalSources.message008')}{' '}
              {describeError(availability.error)}{' '}
              <Button variant="secondary" onClick={() => void availability.refetch()}>
                {uiText('ui.ExternalSources.message009')}
              </Button>
            </p>
          ) : !availability.data.available ? (
            <p role="status">{uiText('ui.ExternalSources.message010')}</p>
          ) : (
            <>
              <Checkbox
                label={uiText('ui.ExternalSources.message011')}
                checked={enabled}
                onChange={(event) => {
                  if (event.target.checked) setEnabled(true);
                  else disable();
                }}
                hint={uiText('ui.ExternalSources.message012')}
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
                    label={uiText('ui.ExternalSources.message013')}
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
                      ? uiText('ui.ExternalSources.message014')
                      : uiText('ui.ExternalSources.message015')}
                  </Button>
                </form>
              ) : (
                <p>{uiText('ui.ExternalSources.message016')}</p>
              )}
            </>
          )}
          {enabled && discovery.error ? (
            <p role="alert">
              {uiText('ui.ExternalSources.message017')} {describeError(discovery.error)}
            </p>
          ) : null}
          {enabled && save.error ? (
            <p role="alert">
              {uiText('ui.ExternalSources.message018')} {describeError(save.error)}
            </p>
          ) : null}
          {currentDiscovery ? (
            <section aria-label={uiText('ui.ExternalSources.message019')}>
              <p role="status">
                {currentDiscovery.results.length}{' '}
                {uiText('ui.ExternalSources.message020')} {currentDiscovery.provider} ·{' '}
                {new Date(currentDiscovery.searchedAt).toLocaleString(getIntlLocale())}
              </p>
              {currentDiscovery.results.length === 0 ? (
                <p>{uiText('ui.ExternalSources.message021')}</p>
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
                          ? uiText('ui.ExternalSources.message022')
                          : uiText('ui.ExternalSources.message023')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </Panel>
      ) : (
        <p>{uiText('ui.ExternalSources.message024')}</p>
      )}
      <Panel title={uiText('ui.ExternalSources.message025')}>
        {references.isPending ? (
          <p role="status">{uiText('ui.ExternalSources.message026')}</p>
        ) : references.error ? (
          <p role="alert">
            {uiText('ui.ExternalSources.message027')} {describeError(references.error)}{' '}
            <Button variant="secondary" onClick={() => void references.refetch()}>
              {uiText('ui.ExternalSources.message028')}
            </Button>
          </p>
        ) : (
          <>
            {references.data.items.length === 0 ? (
              <EmptyState
                size="compact"
                title={uiText('ui.ExternalSources.message029')}
                description={uiText('ui.ExternalSources.message030')}
              />
            ) : (
              <ul className={styles.list}>
                {references.data.items.map((reference) => (
                  <li key={reference.id}>
                    <WebResult result={reference} />
                    <details>
                      <summary>{uiText('ui.ExternalSources.message031')}</summary>
                      <dl>
                        <dt>{uiText('ui.ExternalSources.message032')}</dt>
                        <dd>{reference.provider}</dd>
                        <dt>{uiText('ui.ExternalSources.message033')}</dt>
                        <dd>{reference.query}</dd>
                        <dt>{uiText('ui.ExternalSources.message034')}</dt>
                        <dd>
                          {new Date(reference.discoveredAt).toLocaleString(
                            getIntlLocale(),
                          )}
                        </dd>
                        <dt>{uiText('ui.ExternalSources.message035')}</dt>
                        <dd>
                          {new Date(reference.recordedAt).toLocaleString(getIntlLocale())}
                        </dd>
                        <dt>{uiText('ui.ExternalSources.message036')}</dt>
                        <dd className={styles.hash}>{reference.snapshotSha256}</dd>
                      </dl>
                    </details>
                    <p>{uiText('ui.ExternalSources.message037')}</p>
                  </li>
                ))}
              </ul>
            )}
            <nav
              className={styles.pagination}
              aria-label={uiText('ui.ExternalSources.message038')}
            >
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {uiText('ui.BibliographyLibrary.message011')}
              </Button>
              <span>
                {uiText('ui.ExternalSources.message039')} {page + 1} ·{' '}
                {references.data.totalElements} {uiText('ui.ExternalSources.message040')}
              </span>
              <Button
                variant="secondary"
                disabled={!references.data.hasNext}
                onClick={() => setPage(page + 1)}
              >
                {uiText('ui.BibliographyLibrary.message012')}
              </Button>
            </nav>
          </>
        )}
      </Panel>
    </section>
  );
}

function WebResult({ result }: { readonly result: ExternalResult }): ReactElement {
  useUiLocale();
  return (
    <>
      <Sticker
        tone="yellow"
        icon="globe"
        label={uiText('ui.ExternalSources.message002')}
      />
      <h3>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          {result.title}
        </a>
      </h3>
      <p className={styles.url}>{result.url}</p>
      <p>{result.snippet || uiText('ui.ExternalSources.message041')}</p>
    </>
  );
}
