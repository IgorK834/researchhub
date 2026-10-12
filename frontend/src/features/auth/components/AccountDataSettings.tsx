import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { TextField } from '../../../shared/components/forms';
import { Dialog } from '../../../shared/components/overlays';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { describeError } from '../../../shared/api';
import * as api from '../api/accountDataApi';

export function AccountDataSettings(): ReactElement {
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
    <section aria-label="Account data">
      <h2>Your data</h2>
      <Button
        variant="secondary"
        busy={download.isPending}
        onClick={() => download.mutate()}
      >
        Export personal data (JSON)
      </Button>
      {download.error ? (
        <p role="alert">
          Could not export personal data: {describeError(download.error)}
        </p>
      ) : null}
      <p>
        Deletion erases your private workspaces and replaces your identity with a
        pseudonymous actor in retained history. Shared workspace ownership and retained
        research contributions must be resolved first.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
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
        title="Delete your account"
        closeDisabled={deletion.isPending}
        dismissible={!deletion.isPending}
      >
        <p>
          This permanently erases active personal data and private workspace content.
          Export anything you want to keep first.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            deletion.mutate();
          }}
        >
          <TextField
            label="Confirm your password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {deletion.error ? <p role="alert">{describeError(deletion.error)}</p> : null}
          <Button type="submit" variant="danger" busy={deletion.isPending}>
            Permanently delete account
          </Button>
        </form>
      </Dialog>
    </section>
  );
}

export function AccountDeletionReceipt(): ReactElement {
  const location = useLocation();
  const state = location.state as {
    receipt?: api.ErasureReceipt;
    offlineCleared?: boolean;
  } | null;
  if (!state?.receipt)
    return (
      <main>
        <h1>Account deletion receipt</h1>
        <p>No receipt is available in this browser session.</p>
        <Link to="/login">Return to sign in</Link>
      </main>
    );
  return (
    <main>
      <h1>Account deletion</h1>
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
  const status = useQuery({
    queryKey: ['account-erasure-status', receipt.jobId],
    queryFn: ({ signal }) => api.fetchErasureStatus(receipt, signal),
    refetchInterval: (query) =>
      query.state.data?.status === 'SUCCEEDED' ? false : 10000,
    retry: false,
  });
  return (
    <section aria-label="Account deletion receipt">
      <h2>Account deletion requested</h2>
      <p>
        Your account is blocked and sessions have been revoked. Live-store deletion
        continues as a durable job.
      </p>
      <p>
        Request: <code>{receipt.jobId}</code>
      </p>
      {status.data?.status === 'SUCCEEDED' ? (
        <p role="status">Live-store data erased.</p>
      ) : (
        <p role="status">
          Deletion pending
          {status.data?.errorCode ? ' — storage cleanup is being retried.' : '.'}
        </p>
      )}
      {status.error ? (
        <p role="alert">
          Could not refresh deletion status: {describeError(status.error)}
        </p>
      ) : null}
      <p>
        Backups, offline devices and copies you or collaborators downloaded are outside
        this live-store receipt. Backup erasure is complete only after the retention
        window is separately verified.
      </p>
      {offlineCleared === false ? (
        <p role="alert">
          This browser could not clear all offline copies. Close other ResearchHub tabs
          and clear the site’s local data.
        </p>
      ) : null}
      <Link to="/login" replace state={null}>
        Return to sign in
      </Link>
    </section>
  );
}
