import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): ReactElement {
  return (
    <main>
      <h1>Page not found</h1>
      <p>
        <Link to="/app">Go back home</Link>
      </p>
    </main>
  );
}
