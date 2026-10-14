import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { Dialog } from '../../../shared/components/overlays';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import * as api from '../api/accountDataApi';

export function AccountDataSettings(): ReactElement {
  useUiLocale();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const download = useMutation({ mutationFn: api.downloadAccountData });
  const deletion = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: async (accepted) => {
      setPassword('');
      setOpen(false);
      const offlineCleared = await api.clearResearchhubOfflineData();
      await cache.cancelQueries();
      void navigate('/account-deletion', {
        state: { receipt: accepted, offlineCleared },
        replace: true,
      });
      cache.clear();
    },
  });
  return (
    <section aria-label={uiText('ui.AccountDataSettings.message001')}>
      <h2>{uiText('ui.AccountDataSettings.message002')}</h2>
      <Button
        variant="secondary"
        busy={download.isPending}
        onClick={() => download.mutate()}
      >
        {uiText('ui.AccountDataSettings.message003')}
      </Button>
      {download.error ? (
        <p role="alert">
          {uiText('ui.AccountDataSettings.message004')} {describeError(download.error)}
        </p>
      ) : null}
      <p>{uiText('ui.AccountDataSettings.message005')}</p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {uiText('ui.AccountDataSettings.message006')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!deletion.isPending) {
            setOpen(false);
            setPassword('');
            deletion.reset();
          }
        }}
        title={uiText('ui.AccountDataSettings.message007')}
        closeDisabled={deletion.isPending}
        dismissible={!deletion.isPending}
      >
        <p>{uiText('ui.AccountDataSettings.message008')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            deletion.mutate();
          }}
        >
          <TextField
            label={uiText('ui.AccountDataSettings.message009')}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {deletion.error ? <p role="alert">{describeError(deletion.error)}</p> : null}
          <Button type="submit" variant="danger" busy={deletion.isPending}>
            {uiText('ui.AccountDataSettings.message010')}
          </Button>
        </form>
      </Dialog>
    </section>
  );
}

export function AccountDeletionReceipt(): ReactElement {
  useUiLocale();
  const location = useLocation();
  const state = location.state as {
    receipt?: api.ErasureReceipt;
    offlineCleared?: boolean;
  } | null;
  if (!state?.receipt)
    return (
      <main>
        <h1>{uiText('ui.AccountDataSettings.message011')}</h1>
        <p>{uiText('ui.AccountDataSettings.message012')}</p>
        <Link to="/login">{uiText('ui.AccountDataSettings.message013')}</Link>
      </main>
    );
  return (
    <main>
      <h1>{uiText('ui.AccountDataSettings.message014')}</h1>
      <DeletionProgress receipt={state.receipt} offlineCleared={state.offlineCleared} />
    </main>
  );
}
function DeletionProgress({
  receipt,
  offlineCleared,
}: {
  readonly receipt: api.ErasureReceipt;
  readonly offlineCleared?: boolean;
}): ReactElement {
  useUiLocale();
  const status = useQuery({
    queryKey: ['account-erasure-status', receipt.jobId],
    queryFn: ({ signal }) => api.fetchErasureStatus(receipt, signal),
    refetchInterval: (query) =>
      query.state.data?.status === 'SUCCEEDED' ? false : 10000,
    retry: false,
  });
  return (
    <section aria-label={uiText('ui.AccountDataSettings.message011')}>
      <h2>{uiText('ui.AccountDataSettings.message015')}</h2>
      <p>{uiText('ui.AccountDataSettings.message016')}</p>
      <p>
        {uiText('ui.AccountDataSettings.message017')} <code>{receipt.jobId}</code>
      </p>
      {status.data?.status === 'SUCCEEDED' ? (
        <p role="status">{uiText('ui.AccountDataSettings.message018')}</p>
      ) : (
        <p role="status">
          {uiText('ui.AccountDataSettings.message019')}
          {status.data?.errorCode
            ? ' ' + uiText('ui.AccountDataSettings.message020')
            : '.'}
        </p>
      )}
      {status.error ? (
        <p role="alert">
          {uiText('ui.AccountDataSettings.message021')} {describeError(status.error)}
        </p>
      ) : null}
      <p>{uiText('ui.AccountDataSettings.message022')}</p>
      {offlineCleared === false ? (
        <p role="alert">{uiText('ui.AccountDataSettings.message023')}</p>
      ) : null}
      <Link to="/login" replace state={null}>
        {uiText('ui.AccountDataSettings.message013')}
      </Link>
    </section>
  );
}
