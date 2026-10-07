/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SourceCommandSearch } from './SourceCommandSearch';
import { Dialog } from '../../../shared/components/overlays';
import { searchSourceText } from '../api/sourceTextSearch';
import { fetchCitationFragment } from '../../ai/api/citationEvidence';
import { textHit } from '../testing/searchFixtures';
jest.mock('../api/sourceTextSearch', () => ({
  ...jest.requireActual('../api/sourceTextSearch'),
  searchSourceText: jest.fn(),
}));
jest.mock('../../ai/api/citationEvidence', () => ({ fetchCitationFragment: jest.fn() }));
const search = jest.mocked(searchSourceText),
  fragment = jest.mocked(fetchCitationFragment);
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => void navigate('/next')}>Navigate</button>
      <input aria-label="Existing draft" defaultValue="Unchanged draft" />
    </>
  );
}
function mount(
  workspaceId: string | undefined = 'w1',
  otherModal = false,
  compact = false,
) {
  return render(
    <MemoryRouter initialEntries={['/document']}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SourceCommandSearch
          workspaceId={workspaceId}
          titles={new Map([['s1', 'Solar paper']])}
          compact={compact}
        />
        <Location />
        {otherModal ? (
          <Dialog open title="Other modal" onClose={() => undefined}>
            Other content
          </Dialog>
        ) : null}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
async function findPassage() {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'solar' } });
  await screen.findByRole('option');
}
beforeEach(() => {
  jest.clearAllMocks();
  search.mockResolvedValue([textHit()]);
  fragment.mockResolvedValue(textHit().chunk);
});
it('opens via Cmd and Ctrl K, restores focus on Escape and ignores unrelated/repeated/composing keys', async () => {
  mount();
  const draft = screen.getByLabelText('Existing draft');
  draft.focus();
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  expect(screen.getByRole('dialog').textContent).toContain('Search source text');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(draft);
  for (const props of [
    { key: 'j', ctrlKey: true },
    { key: 'k' },
    { key: 'k', ctrlKey: true, repeat: true },
    { key: 'k', ctrlKey: true, isComposing: true },
    { key: 'k', ctrlKey: true, altKey: true },
    { key: 'k', ctrlKey: true, shiftKey: true },
  ])
    fireEvent.keyDown(document, props);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
  expect(screen.getByRole('dialog')).not.toBeNull();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens the selected immutable source version and location on Enter', async () => {
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Search source text (Cmd or Ctrl K)' }),
  );
  await findPassage();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  await waitFor(() =>
    expect(screen.getByLabelText('Location').textContent).toBe(
      '/app/workspaces/w1/sources/s1?version=v1&processingVersion=p1&page=14&unit=unit-14',
    ),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens a validated passage beside the current document without navigating or discarding its draft', async () => {
  mount();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  await findPassage();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true });
  await screen.findByRole('dialog', { name: 'Solar paper · page 14' });
  await waitFor(() => expect(fragment).toHaveBeenCalled());
  expect(screen.getByLabelText('Location').textContent).toBe('/document');
  expect((screen.getByLabelText('Existing draft') as HTMLInputElement).value).toBe(
    'Unchanged draft',
  );
  await screen.findByText('Source version: v1');
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Location').textContent).toContain(
      '/sources/s1?version=v1',
    ),
  );
});
it('shows a changed/unavailable passage error beside and closes with Escape', async () => {
  fragment.mockRejectedValue(new Error('Changed'));
  mount();
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  await findPassage();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', metaKey: true });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'unavailable or has changed',
  );
  expect(screen.queryByRole('button', { name: 'Open page' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('requires authorized workspace context and lets other modals own the keyboard', () => {
  const view = mount('');
  expect(
    (
      screen.getByRole('button', {
        name: 'Search source text (Cmd or Ctrl K)',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount();
  mount('w1', true, true);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog').textContent).toContain('Other modal');
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('closes on page navigation and supports the close button', () => {
  mount();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
