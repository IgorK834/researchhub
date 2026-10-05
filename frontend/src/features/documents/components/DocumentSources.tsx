import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentNavigation } from '../api/documentNavigation';
import { SourceTypeBadge } from '../../sources/components/SourceVisuals';
import styles from './DocumentFrame.module.css';

/** The page supplies authorized source summaries and version-preserving citation destinations. */
export interface DocumentSourcesProps {
  readonly sources: readonly {
    readonly id: string;
    readonly title: string;
    readonly href: string;
    readonly sourceType?: string;
  }[];
  readonly references: DocumentNavigation['references'];
  readonly analyses?: DocumentNavigation['analyses'];
  readonly workspaceId?: string;
  readonly citationHref: (
    citation: DocumentNavigation['references'][number]['citation'],
  ) => string;
  readonly loading: boolean;
  readonly error: string | null;
}
export function DocumentSources({
  sources,
  references,
  citationHref,
  loading,
  error,
  analyses = [],
  workspaceId,
}: DocumentSourcesProps): ReactElement {
  const cited = new Map<string, DocumentNavigation['references'][number][]>();
  for (const reference of references) {
    const group = cited.get(reference.citation.sourceId) ?? [];
    group.push(reference);
    cited.set(reference.citation.sourceId, group);
  }
  const notCited = sources.filter((source) => !cited.has(source.id));
  return (
    <div className={styles.sourceLists}>
      {analyses.length && workspaceId ? (
        <section aria-label="Analysis blocks in this document">
          <h2>Analysis blocks in this document</h2>
          <ul>
            {analyses.map(({ attrs }) => (
              <li key={attrs.blockId}>
                <span className={`${styles.citationNumber} ${styles.analysisNumber}`}>
                  A
                </span>
                <div>
                  <Link
                    to={`/app/workspaces/${workspaceId}/analyses/${attrs.reference.analysisId}?execution=${encodeURIComponent(attrs.reference.executionId)}`}
                  >
                    {attrs.caption || attrs.reference.outputId}
                  </Link>
                  <p className={styles.meta}>
                    Execution {attrs.reference.executionId.slice(0, 8)} ·{' '}
                    {attrs.reference.renderMode.toLowerCase()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p>
            Each block keeps its selected historical execution. Use Update reference on
            the block to choose another saved result.
          </p>
        </section>
      ) : null}
      <section aria-labelledby="document-cited-heading">
        <h2 id="document-cited-heading">
          Cited in this document{' '}
          <span className={styles.meta}>
            ({cited.size} {cited.size === 1 ? 'source' : 'sources'})
          </span>
        </h2>
        {references.length === 0 ? (
          <p className={styles.meta}>No sources cited yet.</p>
        ) : (
          <ul>
            {[...cited.values()].map((group) => {
              const { citation, citationId, number } = group[0]!;
              const sourceType = sources.find(
                (source) => source.id === citation.sourceId,
              )?.sourceType;
              return (
                <li key={citationId}>
                  <span className={styles.citationNumber}>{number}</span>
                  <div>
                    {sourceType ? <SourceTypeBadge sourceType={sourceType} /> : null}
                    <Link to={citationHref(citation)}>
                      {citation.label ??
                        citation.title ??
                        sources.find((source) => source.id === citation.sourceId)
                          ?.title ??
                        'Source'}
                    </Link>
                    <p className={styles.meta}>
                      {citation.pageStart === null
                        ? (citation.sectionTitle ?? 'Source reference')
                        : `p. ${citation.pageStart}`}
                    </p>
                    {group.length > 1 ? (
                      <div className={styles.citationLocations}>
                        {group.map((reference) => (
                          <Link
                            key={reference.citationId}
                            to={citationHref(reference.citation)}
                            aria-label={`Citation ${reference.number}`}
                          >
                            [{reference.number}]{' '}
                            {reference.citation.pageStart === null
                              ? (reference.citation.sectionTitle ?? 'Source reference')
                              : `p. ${reference.citation.pageStart}`}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="document-not-cited-heading">
        <h2 id="document-not-cited-heading">In the workspace, not cited</h2>
        {loading ? (
          <p role="status">Loading sources…</p>
        ) : error !== null ? (
          <p role="alert">{error}</p>
        ) : notCited.length === 0 ? (
          <p className={styles.meta}>No uncited sources.</p>
        ) : (
          <ul>
            {notCited.map((source) => (
              <li key={source.id}>
                {source.sourceType ? (
                  <SourceTypeBadge sourceType={source.sourceType} />
                ) : null}
                <Link to={source.href}>{source.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
