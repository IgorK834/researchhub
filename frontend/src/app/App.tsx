import type { ReactElement } from 'react';

import { AppProviders } from './AppProviders';
import { AppRouter } from './AppRouter';

export function App(): ReactElement {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
