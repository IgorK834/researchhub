import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Sticker } from '../../../shared/components/identity';
import { Illustration } from '../../../shared/components/Illustration';
import { ResearchHubMark } from '../../../shared/components/shell/AppShell';
import styles from './AuthLayout.module.css';

export interface AuthLayoutProps {
  readonly variant: 'login' | 'register';
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  /** Optional replacement artwork; never contains interactive content. */
  readonly art?: ReactNode;
}

/** Access&home.pdf pp.1–2. The form comes first in focus order in both visual layouts. */
export function AuthLayout({
  variant,
  title,
  subtitle,
  children,
  footer,
  art,
}: AuthLayoutProps): ReactElement {
  const login = variant === 'login';
  return (
    <main className={[styles.layout, styles[variant]].join(' ')}>
      <section className={styles.formHalf} aria-labelledby="auth-title">
        <Link to="/" className={styles.brand} aria-label="ResearchHub">
          <ResearchHubMark />
          <span>ResearchHub</span>
        </Link>
        <div className={styles.formContent}>
          <h1 id="auth-title">{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
          {children}
        </div>
        <footer className={styles.legal}>{footer}</footer>
      </section>
      <div className={styles.artPanel} aria-hidden="true">
        <div className={styles.topSticker}>
          <Sticker
            label={login ? 'Grounded in your sources' : 'Shared sources'}
            tone={login ? 'yellow' : 'blue'}
          />
        </div>
        <div className={styles.art}>
          {art ?? <Illustration scene={login ? 'reading' : 'team'} size="hero" />}
        </div>
        <p className={styles.caption}>
          {login ? 'Read. Question. Cite.' : 'Better together.'}
        </p>
        <div className={styles.bottomSticker}>
          <Sticker
            label={login ? '3 collaborators' : 'One report, many hands'}
            tone={login ? 'mint' : 'coral'}
          />
        </div>
      </div>
    </main>
  );
}
