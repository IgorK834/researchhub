import type { ReactElement, ReactNode } from 'react';

import { Avatar, AvatarStack, type AvatarPerson } from '../identity';
import styles from './Shell.module.css';

export interface AppShellProps {
  readonly tool?: boolean;
  readonly sidebar: ReactNode;
  readonly breadcrumb: ReactNode;
  readonly members?: readonly AvatarPerson[];
  readonly primaryAction?: ReactNode;
  readonly children: ReactNode;
}
/** Desktop frame only. The app composition supplies routes, data and permissions. */
export function AppShell({
  tool = false,
  sidebar,
  breadcrumb,
  members,
  primaryAction,
  children,
}: AppShellProps): ReactElement {
  return (
    <div className={styles.shell} data-tool={tool || undefined}>
      <a className={styles.skip} href="#researchhub-main">
        Skip to content
      </a>
      <aside
        aria-label="Application sidebar"
        className={styles.sidebar}
        data-rh-sidebar=""
      >
        {sidebar}
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          {breadcrumb}
          <div className={styles.topbarActions}>
            {members && members.length > 1 ? (
              <AvatarStack people={members} label="Workspace members" />
            ) : null}
            {primaryAction}
          </div>
        </header>
        <main id="researchhub-main" tabIndex={-1}>
          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </div>
  );
}

export interface ShellSidebarProps {
  readonly brand: ReactNode;
  readonly switcher: ReactNode;
  readonly navigation: ReactNode;
  readonly sticker?: ReactNode;
  readonly footer?: ReactNode;
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly email: string;
  };
  readonly signOut: ReactNode;
}
export function ShellSidebar({
  brand,
  switcher,
  navigation,
  sticker,
  footer,
  user,
  signOut,
}: ShellSidebarProps): ReactElement {
  return (
    <>
      <div className={styles.sidebarScroll}>
        <div className={styles.brand}>{brand}</div>
        {switcher}
        {navigation}
        {sticker === undefined ? null : <div className={styles.sticker}>{sticker}</div>}
      </div>
      <div className={styles.sidebarBottom}>
        {footer}
        <div className={styles.user}>
          <Avatar userId={user.id} name={user.displayName} size="sm" />
          <div className={styles.userText}>
            <strong title={user.displayName}>{user.displayName}</strong>
            <span title={user.email}>{user.email}</span>
          </div>
        </div>
        <div className={styles.signOut}>{signOut}</div>
      </div>
    </>
  );
}

/** Original vector redraw of the reference's five-petal fan; colors come exclusively from tokens. */
export function ResearchHubMark(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 0 32 32"
      className={styles.mark}
    >
      <rect
        x="2"
        y="10"
        width="9"
        height="20"
        rx="4"
        transform="rotate(-35 6 25)"
        className={styles.markBlue}
      />
      <rect
        x="7"
        y="7"
        width="9"
        height="23"
        rx="4"
        transform="rotate(-17 11 25)"
        className={styles.markCoral}
      />
      <rect
        x="22"
        y="10"
        width="9"
        height="20"
        rx="4"
        transform="rotate(35 26 25)"
        className={styles.markYellow}
      />
      <rect
        x="17"
        y="7"
        width="9"
        height="23"
        rx="4"
        transform="rotate(17 21 25)"
        className={styles.markMint}
      />
      <rect x="11" y="5" width="10" height="25" rx="4" className={styles.markLavender} />
    </svg>
  );
}
