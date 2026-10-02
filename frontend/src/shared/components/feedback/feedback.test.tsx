/** @jest-environment jsdom */
import { useEffect } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  Banner,
  Progress,
  Skeleton,
  Spinner,
  StepProgress,
  ToastProvider,
  useToast,
  type BannerTone,
  type ToastInput,
} from './index';
import { Dialog } from '../overlays';

it.each<Exclude<BannerTone, 'note'>>(['info', 'warning', 'error', 'success'])(
  'renders %s banners with a word, decorative icon and the appropriate announcement',
  (tone) => {
    render(
      <Banner tone={tone} lead="Action needed" action={<button>Retry</button>}>
        Your text is safe.
      </Banner>,
    );
    const banner = screen.getByRole(tone === 'error' ? 'alert' : 'status');
    expect(banner.querySelector('strong')?.textContent).toBe('Action needed');
    expect(banner.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(banner.textContent).toContain('Your text is safe.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  },
);
it('supports quiet explanatory notes, explicit existing semantics and custom icons', () => {
  const { rerender } = render(<Banner tone="note" lead="You stay in control." />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen
      .getByText('You stay in control.')
      .parentElement?.parentElement?.classList.contains('note'),
  ).toBe(true);
  rerender(<Banner tone="error" role="status" icon="lock" lead="Unavailable" />);
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  rerender(<Banner lead="Checking" />);
  expect(screen.getByRole('status').textContent).toBe('Checking');
});
it('rejects a wordless banner', () => {
  expect(() => render(<Banner lead=" " />)).toThrow('visible lead');
});

it('announces standalone spinners and keeps inline spinners decorative', () => {
  const { rerender } = render(<Spinner label="Loading sources" />);
  expect(
    screen.getByRole('status', { name: 'Loading sources' }).querySelector('svg'),
  ).not.toBeNull();
  expect(screen.getByText('Loading sources')).not.toBeNull();
  rerender(<Spinner decorative size={20} className="custom" />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.querySelector('.spinner')?.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('.spinner')?.classList.contains('custom')).toBe(true);
});
it('requires a meaningful word on a standalone spinner', () => {
  expect(() => render(<Spinner label=" " />)).toThrow('non-empty label');
});

it.each([0, 62, 100])(
  'provides visible and accessible determinate progress at %s percent',
  (value) => {
    render(<Progress label="Uploading 3 of 5 files" value={value} tone="yellow" />);
    const progress = screen.getByRole('progressbar', { name: 'Uploading 3 of 5 files' });
    expect(progress.getAttribute('aria-valuenow')).toBe(String(value));
    expect(progress.getAttribute('aria-valuetext')).toBe(`${value}%`);
    expect(progress.querySelector<HTMLElement>('.fill')?.style.inlineSize).toBe(
      `${value}%`,
    );
    expect(screen.getByText(`${value}%`)).not.toBeNull();
  },
);
it('represents indeterminate progress without a invented numeric value', () => {
  render(<Progress label="Reading sources" />);
  const progress = screen.getByRole('progressbar');
  expect(progress.hasAttribute('aria-valuenow')).toBe(false);
  expect(progress.getAttribute('aria-valuetext')).toBe('In progress');
  expect(progress.querySelector('.indeterminate')).not.toBeNull();
});
it.each([-1, 101, NaN, Infinity])('rejects invalid progress %s', (value) => {
  expect(() => render(<Progress label="Upload" value={value} />)).toThrow(
    'between 0 and 100',
  );
});
it('labels stepped progress and marks done/current/next, including completion', () => {
  const steps = ['Prepare', 'Generate', 'Run', 'Create'];
  const { rerender } = render(
    <StepProgress steps={steps} currentStep={3} label="Running securely" />,
  );
  const progress = screen.getByRole('progressbar', { name: 'Running securely' });
  expect(progress.getAttribute('aria-valuenow')).toBe('2');
  expect(progress.getAttribute('aria-valuetext')).toBe('Step 3 of 4 · Running securely');
  expect(progress.querySelectorAll('.done')).toHaveLength(2);
  expect(progress.querySelectorAll('.current')).toHaveLength(1);
  expect(screen.getByText('Step 3 of 4 · Running securely')).not.toBeNull();
  rerender(<StepProgress steps={steps} currentStep={5} label="Results ready" />);
  expect(progress.getAttribute('aria-valuenow')).toBe('4');
  expect(progress.querySelectorAll('.done')).toHaveLength(4);
  expect(screen.getByText('Complete · Results ready')).not.toBeNull();
});
it.each([0, 6, 1.5])('rejects invalid current step %s', (currentStep) => {
  expect(() =>
    render(<StepProgress steps={['One']} label="Run" currentStep={currentStep} />),
  ).toThrow('one-based');
});
it('rejects empty step progress', () => {
  expect(() => render(<StepProgress steps={[]} label="Run" currentStep={1} />)).toThrow(
    'one-based',
  );
});

it('keeps skeleton dimensions and shape, hides unknown blocks and always shows known content', () => {
  const { container, rerender } = render(
    <Skeleton width={36} height={36} shape="circle" />,
  );
  const skeleton = container.querySelector<HTMLElement>('.skeleton')!;
  expect(skeleton.getAttribute('aria-hidden')).toBe('true');
  expect(skeleton.style.inlineSize).toBe('36px');
  expect(skeleton.style.blockSize).toBe('36px');
  rerender(<Skeleton />);
  expect(container.querySelector<HTMLElement>('.skeleton')?.style.inlineSize).toBe(
    '100%',
  );
  rerender(<Skeleton shape="block" height={120} />);
  expect(container.querySelector('.block')).not.toBeNull();
  rerender(<Skeleton>Known document title</Skeleton>);
  expect(screen.getByText('Known document title')).not.toBeNull();
  expect(container.querySelector('.skeleton')).toBeNull();
  rerender(<Skeleton>{0}</Skeleton>);
  expect(container.textContent).toBe('0');
});

let api: ReturnType<typeof useToast>;
function Capture() {
  const context = useToast();
  useEffect(() => {
    api = context;
  }, [context]);
  return null;
}
function setupToasts() {
  return render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

it('keeps live regions and toast actions inside the active modal without resetting their lifetime', () => {
  const action = jest.fn();
  const { rerender } = render(
    <ToastProvider>
      <Capture />
      <Dialog open={false} title="Source" onClose={() => {}}>
        Context
      </Dialog>
    </ToastProvider>,
  );
  act(() =>
    api.showToast({
      tone: 'success',
      title: 'Source ready',
      message: 'The source is available.',
      duration: 5000,
      action: { label: 'Open source', onClick: action },
    }),
  );
  const toast = screen.getByText('Source ready').closest('.toast')!;
  act(() => jest.advanceTimersByTime(1000));
  rerender(
    <ToastProvider>
      <Capture />
      <Dialog open title="Source" onClose={() => {}}>
        Context
      </Dialog>
    </ToastProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Source' });
  expect(dialog.contains(toast)).toBe(true);
  expect(toast.closest('[inert]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open source' }));
  expect(action).toHaveBeenCalledTimes(1);
  rerender(
    <ToastProvider>
      <Capture />
      <Dialog open={false} title="Source" onClose={() => {}}>
        Context
      </Dialog>
    </ToastProvider>,
  );
  expect(screen.getByText('Source ready').closest('.toast')).toBe(toast);
  act(() => jest.advanceTimersByTime(3999));
  expect(screen.getByText('Source ready')).not.toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByText('Source ready')).toBeNull();
});

it('keeps a blocking toast available across nested modal lifetimes and parent unmount', () => {
  const scene = (child: boolean) => (
    <ToastProvider>
      <Capture />
      <Dialog open title="Parent" onClose={() => {}}>
        Parent context
      </Dialog>
      <Dialog open={child} title="Child" onClose={() => {}}>
        Child context
      </Dialog>
    </ToastProvider>
  );
  const { rerender } = render(scene(false));
  act(() =>
    api.showToast({
      tone: 'blocking',
      title: 'Save failed',
      message: 'Your text is safe.',
      action: { label: 'Retry now', onClick: jest.fn() },
    }),
  );
  const toast = screen.getByText('Save failed').closest('.toast')!;
  expect(screen.getByRole('dialog', { name: 'Parent' }).contains(toast)).toBe(true);
  rerender(scene(true));
  expect(screen.getByRole('dialog', { name: 'Child' }).contains(toast)).toBe(true);
  act(() => screen.getByRole('button', { name: 'Retry now' }).focus());
  rerender(scene(false));
  expect(screen.getByRole('dialog', { name: 'Parent' }).contains(toast)).toBe(true);
  expect(toast.closest('[inert]')).toBeNull();
  rerender(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
  expect(screen.getByRole('alert').contains(toast)).toBe(true);
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText('Save failed').closest('.toast')).toBe(toast);
});
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('mounts persistent live regions and announces success and blocking toasts with named actions', () => {
  setupToasts();
  const action = jest.fn();
  let successId = 0;
  act(() => {
    successId = api.showToast({
      tone: 'success',
      title: 'Source ready',
      message: '3 sheets · 42 rows read',
      action: { label: 'Open', onClick: action },
    });
    api.showToast({
      tone: 'blocking',
      title: 'Save failed',
      message: 'Your text is safe on this device.',
      action: { label: 'Retry now', onClick: action },
    });
  });
  const status = screen.getByRole('status');
  const alert = screen.getByRole('alert');
  expect(status.textContent).toContain('Source ready');
  expect(alert.textContent).toContain('Save failed');
  expect(alert.textContent).toContain('Your text is safe on this device.');
  expect(alert.querySelector('.toastIcon svg')?.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(action).toHaveBeenCalledTimes(2);
  act(() => api.dismissToast(successId));
  expect(screen.queryByText('Source ready')).toBeNull();
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText('Save failed')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Save failed' }));
  expect(screen.getByRole('alert').textContent).toBe('');
});

it('expires success toasts and pauses the remaining duration while hovered or focused', () => {
  setupToasts();
  act(() =>
    api.showToast({
      tone: 'success',
      title: 'Saved',
      message: 'Document saved.',
      action: { label: 'Open', onClick: jest.fn() },
    }),
  );
  const toast = screen.getByText('Saved').closest<HTMLElement>('.toast')!;
  act(() => jest.advanceTimersByTime(1000));
  fireEvent.pointerEnter(toast);
  act(() => jest.advanceTimersByTime(10000));
  const action = screen.getByRole('button', { name: 'Open' });
  act(() => action.focus());
  fireEvent.pointerLeave(toast);
  act(() => jest.advanceTimersByTime(10000));
  expect(screen.getByText('Saved')).not.toBeNull();
  fireEvent.pointerEnter(toast);
  act(() => action.blur());
  act(() => jest.advanceTimersByTime(10000));
  expect(screen.getByText('Saved')).not.toBeNull();
  fireEvent.pointerLeave(toast);
  act(() => jest.advanceTimersByTime(3999));
  expect(screen.getByText('Saved')).not.toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByText('Saved')).toBeNull();
});

it('keeps explicitly persistent success toasts and gives multiple toasts distinct ids', () => {
  setupToasts();
  let first = 0;
  let second = 0;
  act(() => {
    first = api.showToast({
      tone: 'success',
      title: 'One',
      message: 'Ready.',
      duration: 0,
    });
    second = api.showToast({
      tone: 'success',
      title: 'Two',
      message: 'Ready.',
      duration: 100,
    });
  });
  expect(first).not.toBe(second);
  act(() => jest.advanceTimersByTime(100));
  expect(screen.queryByText('Two')).toBeNull();
  expect(within(screen.getByRole('status')).getByText('One')).not.toBeNull();
});

it('requires a provider and meaningful toast text', () => {
  expect(() => render(<Capture />)).toThrow('ToastProvider');
  setupToasts();
  const invalid: ToastInput[] = [
    { tone: 'success', title: ' ', message: 'Ready' },
    { tone: 'success', title: 'Saved', message: ' ' },
    {
      tone: 'success',
      title: 'Saved',
      message: 'Ready',
      action: { label: ' ', onClick: jest.fn() },
    },
    ...[-1, NaN, Infinity].map((duration): ToastInput => ({
      tone: 'success',
      title: 'Saved',
      message: 'Ready',
      duration,
    })),
  ];
  for (const input of invalid) expect(() => api.showToast(input)).toThrow();
  expect(screen.getByRole('status').textContent).toBe('');
});

it('announces informational toasts politely, allows a lock icon and expires or dismisses them', () => {
  setupToasts();
  act(() =>
    api.showToast({
      tone: 'info',
      title: 'Read-only',
      message: 'Only editors can change this document.',
      duration: 1000,
    }),
  );
  const host = screen.getByRole('region', { name: 'Notifications' });
  expect(within(host).getByRole('status').textContent).toContain('Read-only');
  expect(within(host).getByRole('alert').textContent).toBe('');
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.queryByText('Read-only')).toBeNull();
  act(() =>
    api.showToast({
      tone: 'info',
      icon: 'lock',
      title: 'Viewer',
      message: 'Read and ask AI.',
      duration: 0,
    }),
  );
  act(() => jest.advanceTimersByTime(10_000));
  expect(screen.getByText('Viewer')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Viewer' }));
  expect(screen.queryByText('Viewer')).toBeNull();
});
