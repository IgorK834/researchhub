import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
  return (
    <section aria-labelledby="document-outline-heading" className={styles.outline}>
      <h2 id="document-outline-heading">{uiText('ui.DocumentOutline.message001')}</h2>
      {navigation.headings.length === 0 ? (
        <p className={styles.meta}>{uiText('ui.DocumentOutline.message002')}</p>
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
  useUiLocale();
  return (
    <section aria-labelledby="content-origin-heading" className={styles.legend}>
      <h2 id="content-origin-heading">{uiText('ui.DocumentOutline.message003')}</h2>
      <ul>
        <li data-origin="human">{uiText('ui.DocumentOutline.message004')}</li>
        <li data-origin="ai">{uiText('ui.DocumentOutline.message005')}</li>
        <li data-origin="source">{uiText('ui.DocumentOutline.message006')}</li>
        <li data-origin="analysis">{uiText('ui.DocumentOutline.message007')}</li>
      </ul>
      <p className={styles.meta}>{uiText('ui.DocumentOutline.message008')}</p>
    </section>
  );
}
