import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../api/useAuth';
import { requestVerification, verificationStatus, verifyEmail } from '../api/accountApi';
import { acceptInvitation } from '../../workspaces/api/invitationApi';
import { describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { AuthLayout } from './AuthLayout';

export function AccountLink({
  kind,
}: {
  readonly kind: 'invite' | 'verify';
}): ReactElement {
  const { hash } = useLocation();
  const token = hash.slice(1);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const status = useQuery({
    queryKey: ['auth', 'verification'],
    queryFn: ({ signal }) => verificationStatus(signal),
    enabled: !!user.data,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const action = useMutation({
    mutationFn: async () => {
      if (kind === 'verify') {
        await verifyEmail(token);
        return null;
      }
      return acceptInvitation(token);
    },
    onSuccess: (result) => {
      void cache.invalidateQueries({ queryKey: ['auth', 'verification'] });
      void cache.invalidateQueries({ queryKey: ['workspaces'] });
      if (result) void navigate(`/app/workspaces/${result.workspaceId}`);
    },
  });
  const verify = useMutation({ mutationFn: requestVerification });
  return (
    <AuthLayout
      variant="login"
      title={kind === 'invite' ? 'Workspace invitation' : 'Verify email'}
      footer="ResearchHub"
      subtitle={
        kind === 'invite'
          ? 'Sign in with the invited email address to join.'
          : 'Confirm your email address.'
      }
    >
      {!token ? (
        <p role="alert">This link is incomplete.</p>
      ) : user.isPending ? (
        <p role="status">Checking your session…</p>
      ) : user.error ? (
        <p role="alert">{describeError(user.error)}</p>
      ) : !user.data ? (
        <>
          <p>
            <Link to={`/login#${kind}:${token}`}>Log in</Link>
          </p>
          {kind === 'invite' ? (
            <p>
              <Link to={`/register#${token}`}>Create account with this invitation</Link>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p>Signed in as {user.data.email}.</p>
          {kind === 'invite' && status.data?.emailVerifiedAt === null ? (
            <>
              <p>Verify your email first, then return to this invitation.</p>
              <Button onClick={() => verify.mutate()} busy={verify.isPending}>
                Send verification link
              </Button>
              <Button
                onClick={() => {
                  void status.refetch();
                }}
              >
                I have verified my email
              </Button>
              {verify.isSuccess ? (
                <p role="status">Verification link requested. Check your email.</p>
              ) : null}
            </>
          ) : (
            <Button
              onClick={() => action.mutate()}
              busy={action.isPending}
              disabled={action.isSuccess || status.isPending}
            >
              {kind === 'invite' ? 'Accept invitation' : 'Verify email'}
            </Button>
          )}
          {action.isSuccess && kind === 'verify' ? (
            <p role="status">
              Email verified. You can return to your invitation or{' '}
              <Link to="/app/account">account settings</Link>.
            </p>
          ) : null}
          {status.error ? <p role="alert">{describeError(status.error)}</p> : null}
          {action.error || verify.error ? (
            <p role="alert">{describeError(action.error ?? verify.error)}</p>
          ) : null}
          <p>
            <Link to="/app/account">Account settings</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
