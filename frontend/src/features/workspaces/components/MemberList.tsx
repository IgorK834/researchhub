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
      <h2 id="workspace-members-heading">Workspace members</h2>
      {isPending ? (
        <p role="status" aria-live="polite">
          Loading members…
        </p>
      ) : null}
      {error !== null && !isPending ? (
        <Banner tone="error" lead="Could not load the members">
          {describeError(error)}
        </Banner>
      ) : null}
      {changeRole.error !== null ? (
        <Banner tone="error" lead={describeError(changeRole.error)} />
      ) : null}
      {members !== undefined && error === null ? (
        <DataTable
          caption="Members"
          rows={members}
          rowKey={(member) => member.userId}
          columns={[
            {
              id: 'member',
              header: 'Member',
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
              header: 'Role',
              render: (member) => <RoleBadge role={member.role} />,
            },
            ...(canManage
              ? [
                  {
                    id: 'actions',
                    header: 'Actions',
                    render: (member: WorkspaceMember) => (
                      <div className={styles.actions}>
                        <Menu
                          label={`Role for ${member.displayName}`}
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
                              label: 'Make owner',
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
                          aria-label={`Remove ${member.displayName}`}
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
        title={`Remove ${removing?.displayName ?? 'member'}?`}
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
              Keep
            </Button>
            <Button
              variant="danger"
              busy={removeMember.isPending}
              busyLabel="Removing…"
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
              Remove member
            </Button>
          </>
        }
      >
        <p>
          This person will lose access to the workspace. Their edits and contributions
          will stay.
        </p>
        {removeMember.error !== null ? (
          <Banner tone="error" lead={describeError(removeMember.error)} />
        ) : null}
      </Dialog>
    </section>
  );
}
