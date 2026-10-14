import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { DataTable } from '../../../shared/components/content';
import { Banner } from '../../../shared/components/feedback';
import { Avatar, RoleBadge } from '../../../shared/components/identity';
import { Dialog, Menu } from '../../../shared/components/overlays';
import type { WorkspaceMember } from '../api/workspaceApi';
import {
  useChangeWorkspaceMemberRole,
  useRemoveWorkspaceMember,
  useWorkspaceMembersQuery,
} from '../api/useWorkspaces';
import styles from './WorkspaceViews.module.css';

/** UI management affordances only; every write is still authorized by the server. */
export function MemberList({
  workspaceId,
  canManage,
}: {
  readonly workspaceId: string;
  readonly canManage: boolean;
}): ReactElement {
  useUiLocale();
  const { data: members, error, isPending } = useWorkspaceMembersQuery(workspaceId);
  const changeRole = useChangeWorkspaceMemberRole(workspaceId);
  const removeMember = useRemoveWorkspaceMember(workspaceId);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const removed = useRef(false);
  const busy = changeRole.isPending || removeMember.isPending;
  useLayoutEffect(() => {
    if (removing === null && removed.current) {
      removed.current = false;
      // A removed row no longer owns a return-focus target.
      sectionRef.current?.focus();
    }
  }, [removing]);
  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="workspace-members-heading">
      <h2 id="workspace-members-heading">{uiText('ui.MemberList.message001')}</h2>
      {isPending ? (
        <p role="status" aria-live="polite">
          {uiText('ui.MemberList.message002')}
        </p>
      ) : null}
      {error !== null && !isPending ? (
        <Banner tone="error" lead={uiText('ui.MemberList.message013')}>
          {describeError(error)}
        </Banner>
      ) : null}
      {changeRole.error !== null ? (
        <Banner tone="error" lead={describeError(changeRole.error)} />
      ) : null}
      {members !== undefined && error === null ? (
        <DataTable
          caption={uiText('ui.MemberList.message003')}
          rows={members}
          rowKey={(member) => member.userId}
          columns={[
            {
              id: 'member',
              get header() {
                return uiText('ui.MemberList.message004');
              },
              rowHeader: true,
              render: (member) => (
                <div className={styles.member}>
                  <Avatar userId={member.userId} name={member.displayName} />
                  <div>
                    <div className={styles.memberName}>{member.displayName}</div>
                    <div className={styles.memberEmail}>{member.email}</div>
                  </div>
                </div>
              ),
            },
            {
              id: 'role',
              get header() {
                return uiText('ui.AddMemberForm.message002');
              },
              render: (member) => <RoleBadge role={member.role} />,
            },
            ...(canManage
              ? [
                  {
                    id: 'actions',
                    get header() {
                      return uiText('ui.DocumentList.message020');
                    },
                    render: (member: WorkspaceMember) => (
                      <div className={styles.actions}>
                        <Menu
                          label={uiText('ui.MemberList.message005', {
                            value0: member.displayName,
                          })}
                          triggerIcon="sliders"
                          disabled={busy}
                          items={[
                            ...(['EDITOR', 'VIEWER'] as const).map((role) => ({
                              id: role,
                              label: role === 'EDITOR' ? 'Editor' : 'Viewer',
                              icon:
                                member.role === role
                                  ? ('check' as const)
                                  : role === 'EDITOR'
                                    ? ('pencil' as const)
                                    : ('eye' as const),
                              shortcut: member.role === role ? 'Current' : undefined,
                              disabled: busy || member.role === role,
                              onSelect: () => {
                                if (!busy)
                                  changeRole.mutate({ userId: member.userId, role });
                              },
                            })),
                            {
                              id: 'OWNER',
                              get label() {
                                return uiText('ui.MemberList.message006');
                              },
                              icon: 'key',
                              separatorBefore: true,
                              disabled: busy || member.role === 'OWNER',
                              onSelect: () => {
                                if (!busy)
                                  changeRole.mutate({
                                    userId: member.userId,
                                    role: 'OWNER',
                                  });
                              },
                            },
                          ]}
                        />
                        <Button
                          iconOnly
                          icon="x"
                          variant="danger-soft"
                          aria-label={uiText('ui.SourceComparisonPanel.message008', {
                            value0: member.displayName,
                          })}
                          disabled={busy}
                          onClick={(event) => {
                            triggerRef.current = event.currentTarget;
                            removeMember.reset();
                            setRemoving(member);
                          }}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      <Dialog
        open={removing !== null && canManage}
        title={uiText('ui.MemberList.message007', {
          value0: removing?.displayName ?? uiText('ui.MemberList.message008'),
        })}
        onClose={() => {
          if (!removeMember.isPending) setRemoving(null);
        }}
        dismissible={!removeMember.isPending}
        closeDisabled={removeMember.isPending}
        initialFocusRef={keepRef}
        returnFocusRef={triggerRef}
        footer={
          <>
            <Button
              ref={keepRef}
              variant="secondary"
              disabled={removeMember.isPending}
              onClick={() => setRemoving(null)}
            >
              {uiText('ui.MemberList.message009')}
            </Button>
            <Button
              variant="danger"
              busy={removeMember.isPending}
              busyLabel={uiText('ui.MemberList.message010')}
              onClick={() => {
                if (removing !== null && !busy)
                  removeMember.mutate(removing.userId, {
                    onSuccess: () => {
                      removed.current = true;
                      setRemoving(null);
                    },
                  });
              }}
            >
              {uiText('ui.MemberList.message011')}
            </Button>
          </>
        }
      >
        <p>{uiText('ui.MemberList.message012')}</p>
        {removeMember.error !== null ? (
          <Banner tone="error" lead={describeError(removeMember.error)} />
        ) : null}
      </Dialog>
    </section>
  );
}
