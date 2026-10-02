import type { ReactElement } from 'react';

import { describeError } from '../../../shared/api';
import { Select } from '../../../shared/components/forms';
import {
  useChangeWorkspaceMemberRole,
  useRemoveWorkspaceMember,
  useWorkspaceMembersQuery,
} from '../api/useWorkspaces';

interface MemberListProps {
  readonly workspaceId: string;
  /**
   * Whether to render the role and remove controls.
   *
   * Presentation only. The caller passes `true` for an owner of an active workspace, and the server
   * checks `MANAGE_MEMBERS` on every request regardless — a forged call still gets 403, and a change to
   * an archived workspace still gets 409.
   */
  readonly canManage: boolean;
}

const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;

/**
 * Who is in this workspace.
 *
 * Shown to every member, including viewers and on an archived workspace, because knowing who you are
 * collaborating with is part of the workspace rather than a privilege inside it. A non-member never
 * renders this: the server answers the roster with the same 404 as the workspace itself, so the detail
 * page has already shown its not-found state.
 */
export function MemberList({ workspaceId, canManage }: MemberListProps): ReactElement {
  const { data: members, error, isPending } = useWorkspaceMembersQuery(workspaceId);
  const changeRole = useChangeWorkspaceMemberRole(workspaceId);
  const removeMember = useRemoveWorkspaceMember(workspaceId);

  // A refused change: most usefully the 409 from demoting or removing the last owner, whose detail
  // already explains what to do instead.
  const changeFailure = changeRole.error ?? removeMember.error;
  const busy = changeRole.isPending || removeMember.isPending;

  return (
    <section aria-labelledby="workspace-members-heading">
      <h2 id="workspace-members-heading">Members</h2>

      {isPending ? (
        <p role="status" aria-live="polite">
          Loading members…
        </p>
      ) : null}

      {error !== null && !isPending ? (
        <p role="alert">Could not load the members: {describeError(error)}</p>
      ) : null}

      {changeFailure !== null ? <p role="alert">{describeError(changeFailure)}</p> : null}

      {members !== undefined && error === null ? (
        <ul>
          {members.map((member) => (
            <li key={member.userId}>
              <span>{member.displayName}</span> <span>{member.email}</span>
              {canManage ? (
                <>
                  <Select
                    id={`member-role-${member.userId}`}
                    label={`Role for ${member.displayName}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) => {
                      changeRole.mutate({
                        userId: member.userId,
                        role: event.target.value,
                      });
                    }}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      removeMember.mutate(member.userId);
                    }}
                  >
                    Remove {member.displayName}
                  </button>
                </>
              ) : (
                <span> — {member.role}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
