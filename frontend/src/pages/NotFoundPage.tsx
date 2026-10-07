import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Illustration } from '../shared/components/Illustration';
import styles from './NotFoundPage.module.css';

export function NotFoundPage(): ReactElement {
  return (
    <main className={styles.page}>
      <Illustration scene="search" />
      <h1>Page not found</h1>
      <p>
        <Link to="/app">Go back home</Link>
      </p>
    </main>
  );
}
