import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useCurrentUser } from '../../auth/api/useAuth';
import { Button } from '../../../shared/components/Button';
import { ResearchHubMark } from '../../../shared/components/shell/AppShell';
import { NAV_LINKS } from '../landingContent';
import { LinkButton } from './LinkButton';
import styles from './LandingHeader.module.css';

/**
 * Sticky public navigation. Section links are plain in-page anchors; Log in and Create account lead to the
 * existing auth routes, and a visitor who already has a session is offered the app instead.
 */
export function LandingHeader(): ReactElement {
  const [open, setOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const close = (): void => setOpen(false);

  const actions =
    user === null || user === undefined ? (
      <>
        <LinkButton to="/login" variant="ghost" onNavigate={close}>
          Log in
        </LinkButton>
        <LinkButton to="/register" onNavigate={close}>
          Create account
        </LinkButton>
      </>
    ) : (
      <LinkButton to="/app" icon="arrowRight" onNavigate={close}>
        Open workspaces
      </LinkButton>
    );

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#landing-main">
        Skip to content
      </a>
      <div className={styles.bar}>
        <Link to="/" className={styles.brand} aria-label="ResearchHub home">
          <ResearchHubMark />
          <span>ResearchHub</span>
        </Link>
        <nav className={styles.nav} aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.id} href={`#${link.id}`} className={styles.link}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.actions}>{actions}</div>
        <Button
          variant="secondary"
          iconOnly
          icon={open ? 'x' : 'list'}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="landing-menu"
          className={styles.toggle}
          onClick={() => setOpen((value) => !value)}
        />
      </div>
      <div id="landing-menu" className={styles.menu} hidden={!open}>
        <nav aria-label="Sections (mobile)" className={styles.menuNav}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={styles.menuLink}
              onClick={close}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.menuActions}>{actions}</div>
      </div>
    </header>
  );
}
