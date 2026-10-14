import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useCurrentUser } from '../../auth/api/useAuth';
import { Button } from '../../../shared/components/Button';
import { ResearchHubMark } from '../../../shared/components/shell/AppShell';
import { NAV_LINKS } from '../landingContent';
import { LinkButton } from './LinkButton';
import styles from './LandingHeader.module.css';
import { usePublicConfig } from '../../../app/PublicConfig';
import { LanguageSwitcher } from '../../../shared/i18n';

/**
 * Sticky public navigation. Section links are plain in-page anchors; Log in and Create account lead to the
 * existing auth routes, and a visitor who already has a session is offered the app instead.
 */
export function LandingHeader(): ReactElement {
  useUiLocale();
  const { config } = usePublicConfig();
  const [open, setOpen] = useState(false);
  const { data: user } = useCurrentUser();
  const close = (): void => setOpen(false);

  const actions =
    user === null || user === undefined ? (
      <>
        <LinkButton to="/login" variant="ghost" onNavigate={close}>
          {uiText('ui.AccountLink.message007')}
        </LinkButton>
        {config?.registrationMode === 'open' ? (
          <LinkButton to="/register" onNavigate={close}>
            {uiText('ui.LandingHeader.message001')}
          </LinkButton>
        ) : null}
      </>
    ) : (
      <LinkButton to="/app" icon="arrowRight" onNavigate={close}>
        {uiText('ui.LandingHeader.message002')}
      </LinkButton>
    );

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#landing-main">
        {uiText('ui.LandingHeader.message003')}
      </a>
      <div className={styles.bar}>
        <Link
          to="/"
          className={styles.brand}
          aria-label={uiText('ui.LandingHeader.message004')}
        >
          <ResearchHubMark />
          <span>ResearchHub</span>
        </Link>
        <nav className={styles.nav} aria-label={uiText('ui.LandingHeader.message005')}>
          {NAV_LINKS.map((link) => (
            <a key={link.id} href={`#${link.id}`} className={styles.link}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.actions}>{actions}</div>
        <LanguageSwitcher />
        <Button
          variant="secondary"
          iconOnly
          icon={open ? 'x' : 'list'}
          aria-label={
            open
              ? uiText('ui.LandingHeader.message006')
              : uiText('ui.LandingHeader.message007')
          }
          aria-expanded={open}
          aria-controls="landing-menu"
          className={styles.toggle}
          onClick={() => setOpen((value) => !value)}
        />
      </div>
      <div id="landing-menu" className={styles.menu} hidden={!open}>
        <nav
          aria-label={uiText('ui.LandingHeader.message008')}
          className={styles.menuNav}
        >
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
