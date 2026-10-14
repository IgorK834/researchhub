import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
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
  {
    get title() {
      return uiText('ui.WorkspaceListPage.message001');
    },
    get detail() {
      return uiText('workspace.stepSources');
    },
    tone: 'blue',
  },
  {
    get title() {
      return uiText('ui.WorkspaceListPage.message002');
    },
    get detail() {
      return uiText('workspace.stepDocuments');
    },
    tone: 'coral',
  },
  {
    get title() {
      return uiText('ui.WorkspaceListPage.message003');
    },
    get detail() {
      return uiText('workspace.stepQuestions');
    },
    tone: 'mint',
  },
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
  useUiLocale();
  const { data, error, isPending } = useWorkspacesQuery();
  const context = useOutletContext<AppOutletContext | null>();
  const { openCreateWorkspace } = useCreateWorkspaceDialog();
  const displayName = context?.user.displayName.trim();

  return (
    <section className={styles.home}>
      <header className={styles.greeting}>
        <h1>
          {displayName
            ? uiText('ui.WorkspaceListPage.message004', { value0: displayName })
            : uiText('ui.WorkspaceListPage.message005')}
        </h1>
      </header>

      {isPending ? (
        <>
          <p role="status" aria-live="polite">
            {uiText('ui.WorkspaceListPage.message006')}
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
        <Banner tone="error" lead={uiText('ui.WorkspaceListPage.message010')}>
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
              description={uiText('ui.WorkspaceListPage.message007')}
              actions={[
                <Button
                  key="create"
                  size="large"
                  icon="plus"
                  onClick={(event) => openCreateWorkspace(event.currentTarget)}
                >
                  {uiText('ui.CreateWorkspaceDialog.message001')}
                </Button>,
              ]}
            />
            <ol
              className={styles.steps}
              aria-label={uiText('ui.WorkspaceListPage.message008')}
            >
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
            <h2 id="recent-workspaces-heading">
              {uiText('ui.WorkspaceListPage.message009')}
            </h2>
            <WorkspaceList workspaces={data} />
          </section>
        )
      ) : null}
    </section>
  );
}
