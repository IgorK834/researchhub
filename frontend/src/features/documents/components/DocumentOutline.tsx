import type { ReactElement } from 'react';
import type { DocumentNavigation } from '../api/documentNavigation';
import styles from './DocumentFrame.module.css';

export function DocumentOutline({
  navigation,
  onNavigate,
}: {
  readonly navigation: DocumentNavigation;
  readonly onNavigate: (position: number) => void;
}): ReactElement {
  return (
    <section aria-labelledby="document-outline-heading" className={styles.outline}>
      <h2 id="document-outline-heading">Outline</h2>
      {navigation.headings.length === 0 ? (
        <p className={styles.meta}>Add headings to build an outline.</p>
      ) : (
        <ol>
          {navigation.headings.map((heading) => (
            <li key={heading.position}>
              <button
                type="button"
                data-level={heading.level}
                aria-current={
                  navigation.activePosition === heading.position ? 'location' : undefined
                }
                onClick={() => onNavigate(heading.position)}
              >
                {heading.title}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ContentOriginLegend(): ReactElement {
  return (
    <section aria-labelledby="content-origin-heading" className={styles.legend}>
      <h2 id="content-origin-heading">Content origin</h2>
      <ul>
        <li data-origin="human">Human contribution</li>
        <li data-origin="ai">AI generated / rewritten</li>
        <li data-origin="source">Imported content</li>
        <li data-origin="analysis">Analysis derived</li>
      </ul>
      <p className={styles.meta}>
        Inspect recorded operations in Provenance. This is not AI detection.
      </p>
    </section>
  );
}
