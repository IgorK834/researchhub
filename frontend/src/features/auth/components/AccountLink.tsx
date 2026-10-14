import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
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
  useUiLocale();
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
      title={
        kind === 'invite'
          ? uiText('ui.AccountLink.message001')
          : uiText('ui.AccountLink.message002')
      }
      footer="ResearchHub"
      subtitle={
        kind === 'invite'
          ? uiText('ui.AccountLink.message003')
          : uiText('ui.AccountLink.message004')
      }
    >
      {!token ? (
        <p role="alert">{uiText('ui.AccountLink.message005')}</p>
      ) : user.isPending ? (
        <p role="status">{uiText('ui.AccountLink.message006')}</p>
      ) : user.error ? (
        <p role="alert">{describeError(user.error)}</p>
      ) : !user.data ? (
        <>
          <p>
            <Link to={`/login#${kind}:${token}`}>
              {uiText('ui.AccountLink.message007')}
            </Link>
          </p>
          {kind === 'invite' ? (
            <p>
              <Link to={`/register#${token}`}>{uiText('ui.AccountLink.message008')}</Link>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p>
            {uiText('ui.AccountLink.message009')} {user.data.email}.
          </p>
          {kind === 'invite' && status.data?.emailVerifiedAt === null ? (
            <>
              <p>{uiText('ui.AccountLink.message010')}</p>
              <Button onClick={() => verify.mutate()} busy={verify.isPending}>
                {uiText('ui.AccountLink.message011')}
              </Button>
              <Button
                onClick={() => {
                  void status.refetch();
                }}
              >
                {uiText('ui.AccountLink.message012')}
              </Button>
              {verify.isSuccess ? (
                <p role="status">{uiText('ui.AccountLink.message013')}</p>
              ) : null}
            </>
          ) : (
            <Button
              onClick={() => action.mutate()}
              busy={action.isPending}
              disabled={action.isSuccess || status.isPending}
            >
              {kind === 'invite'
                ? uiText('ui.AccountLink.message014')
                : uiText('ui.AccountLink.message002')}
            </Button>
          )}
          {action.isSuccess && kind === 'verify' ? (
            <p role="status">
              {uiText('ui.AccountLink.message015')}{' '}
              <Link to="/app/account">{uiText('ui.AccountLink.message016')}</Link>.
            </p>
          ) : null}
          {status.error ? <p role="alert">{describeError(status.error)}</p> : null}
          {action.error || verify.error ? (
            <p role="alert">{describeError(action.error ?? verify.error)}</p>
          ) : null}
          <p>
            <Link to="/app/account">{uiText('ui.AccountLink.message017')}</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
