import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router-dom';

import { useWorkspacesQuery } from '../features/workspaces/api/useWorkspaces';
import { useCreateWorkspaceDialog } from '../features/workspaces/components/CreateWorkspaceDialog';
import { WorkspaceList } from '../features/workspaces/components/WorkspaceList';
import { describeError } from '../shared/api';
import type { AppOutletContext } from '../app/AppOutletContext';
import { Button } from '../shared/components/Button';
import { Illustration } from '../shared/components/Illustration';
import { Card, EmptyState, emptyStateCopy } from '../shared/components/content';
import { Banner, Skeleton } from '../shared/components/feedback';
import styles from '../features/workspaces/components/Workspaces.module.css';

const steps = [
  { title: 'Add sources', detail: 'PDFs, notes and data', tone: 'blue' },
  { title: 'Write together', detail: 'Documents with citations', tone: 'coral' },
  { title: 'Check the evidence', detail: 'Ask AI, see where it came from', tone: 'mint' },
] as const;

/**
 * The signed-in user's workspaces, and the form for adding one.
 *
 * Renders inside the protected `/app` shell, so there is always a user by the time this mounts and the
 * page does not repeat the session check.
 *
 * The page owns the loading, error, and success branches; the feature owns the transport and the query
 * key. An empty list is a success, not an error — it is what a new account correctly sees.
 */
export function WorkspaceListPage(): ReactElement {
  const { data, error, isPending } = useWorkspacesQuery();
  const context = useOutletContext<AppOutletContext | null>();
  const { openCreateWorkspace } = useCreateWorkspaceDialog();
  const displayName = context?.user.displayName.trim();

  return (
    <section className={styles.home}>
      <header className={styles.greeting}>
        <h1>
          {displayName ? `Welcome back, ${displayName}.` : 'Welcome to ResearchHub.'}
        </h1>
      </header>

      {isPending ? (
        <>
          <p role="status" aria-live="polite">
            Loading your workspaces…
          </p>
          <div className={styles.loadingGrid} aria-hidden="true">
            {[0, 1, 2, 3].map((key) => (
              <Card key={key} className={styles.workspaceCard}>
                <Skeleton height={24} width="80%" />
                <Skeleton height={56} shape="block" />
                <Skeleton height={22} width="40%" />
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {error !== null && !isPending ? (
        <Banner tone="error" lead="Could not load your workspaces">
          {describeError(error)}
        </Banner>
      ) : null}

      {data !== undefined && error === null ? (
        data.length === 0 ? (
          <div className={styles.firstRun}>
            <EmptyState
              context={emptyStateCopy.workspaces.context}
              art={<Illustration scene="workspace" />}
              title={emptyStateCopy.workspaces.title}
              description="A workspace holds your sources, documents and analyses — and the people you work on them with."
              actions={[
                <Button
                  key="create"
                  size="large"
                  icon="plus"
                  onClick={(event) => openCreateWorkspace(event.currentTarget)}
                >
                  Create workspace
                </Button>,
              ]}
            />
            <ol className={styles.steps} aria-label="Getting started">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <Card className={styles.step}>
                    <span
                      aria-hidden="true"
                      className={[styles.stepNumber, styles[step.tone]].join(' ')}
                    >
                      {index + 1}
                    </span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.detail}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <section className={styles.recent} aria-labelledby="recent-workspaces-heading">
            <h2 id="recent-workspaces-heading">Recent workspaces</h2>
            <WorkspaceList workspaces={data} />
          </section>
        )
      ) : null}
    </section>
  );
}
