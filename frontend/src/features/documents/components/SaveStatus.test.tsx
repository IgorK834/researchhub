/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { ApiError, ApiTransportError } from '../../../shared/api';
import type { AutosaveState } from '../autosave/documentAutosave';
import { SaveStatus } from './SaveStatus';

const base: AutosaveState = { status: 'saved', revision: 4, error: null, blocked: false };
const savedAt = '2026-10-02T10:55:00Z';
const problem = (extra: Partial<ApiError['problem']> = {}) =>
  new ApiError({
    type: 'about:blank',
    title: 'Conflict',
    detail: 'Changed by another writer.',
    status: 409,
    code: 'CONFLICT',
    rawCode: 'CONFLICT',
    ...extra,
  });
function setup(state: AutosaveState = base, host?: HTMLElement) {
  const retry = jest.fn();
  const discard = jest.fn();
  const result = render(
    <SaveStatus
      state={state}
      savedAt={savedAt}
      statusHost={host}
      onRetry={retry}
      onDiscardLocalChanges={discard}
    />,
  );
  return { ...result, retry, discard };
}
it('shows an acknowledged server timestamp and announces each chip with an icon and a word', () => {
  const { rerender } = setup();
  expect(screen.getByRole('status').querySelector('time')?.getAttribute('datetime')).toBe(
    savedAt,
  );
  expect(screen.getByRole('status').textContent).toContain(
    new Date(savedAt).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
  );
  for (const [status, label] of [
    ['saving', 'Saving…'],
    ['unsaved', 'Unsaved changes'],
    ['saved', 'Saved'],
  ] as const) {
    rerender(
      <SaveStatus
        state={{ ...base, status }}
        savedAt={savedAt}
        onRetry={jest.fn()}
        onDiscardLocalChanges={jest.fn()}
      />,
    );
    const chip = screen.getByRole('status');
    expect(chip.querySelector('strong')?.textContent).toBe(label);
    expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(chip.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('alert')).toBeNull();
  }
});
it('portals just the chip and keeps failed-save safety copy and retry beside the paper', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { container, retry, unmount } = setup(
    { ...base, status: 'failed', error: new ApiTransportError('Connection failed.') },
    host,
  );
  expect(host.querySelector('strong')?.textContent).toBe('Save failed');
  expect(container.contains(screen.getByRole('alert'))).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain(
    'Your changes are still here and have not been saved.',
  );
  expect(screen.getByRole('alert').textContent).toContain('Connection failed.');
  expect(container.textContent).not.toMatch(
    /safe on this device|stored locally|kept on this device/i,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  expect(retry).toHaveBeenCalledTimes(1);
  unmount();
  host.remove();
});
it('keeps validation copy and explains a missing title before saving', () => {
  const { rerender } = setup({
    ...base,
    status: 'failed',
    error: problem({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'title', message: 'Required' }],
    }),
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'The server did not accept this version.',
  );
  rerender(
    <SaveStatus
      state={{ ...base, status: 'unsaved', blocked: true }}
      savedAt="invalid"
      onRetry={jest.fn()}
      onDiscardLocalChanges={jest.fn()}
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('a title is required');
  rerender(
    <SaveStatus
      state={base}
      savedAt="invalid"
      onRetry={jest.fn()}
      onDiscardLocalChanges={jest.fn()}
    />,
  );
  expect(screen.getByRole('status').querySelector('time')?.textContent).toBe('invalid');
});
it.each([problem({ currentRevision: 7 }), problem(), new Error('unknown')])(
  'retains conflict safety copy and offers only the existing latest-version action',
  (error) => {
    const { discard } = setup({ ...base, status: 'conflict', error });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'Autosave has stopped until you choose what to do.',
    );
    if (error instanceof ApiError && error.problem.currentRevision)
      expect(alert.textContent).toContain('now at revision 7');
    else expect(alert.textContent).not.toContain('now at revision');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Discard my changes and load the latest version',
      }),
    );
    expect(discard).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Compare|Keep mine|Take theirs/ }),
    ).toBeNull();
  },
);
