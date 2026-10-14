import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Illustration } from '../shared/components/Illustration';
import styles from './NotFoundPage.module.css';

export function NotFoundPage(): ReactElement {
  useUiLocale();
  return (
    <main className={styles.page}>
      <Illustration scene="search" />
      <h1>{uiText('ui.NotFoundPage.message001')}</h1>
      <p>
        <Link to="/app">{uiText('ui.NotFoundPage.message002')}</Link>
      </p>
    </main>
  );
}
