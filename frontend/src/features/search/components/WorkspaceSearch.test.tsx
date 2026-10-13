/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { searchWorkspace, type WorkspaceSearchPage } from '../api/workspaceSearchApi';
import { WorkspaceCommandSearch } from './WorkspaceCommandSearch';
jest.mock('../api/workspaceSearchApi');
const results: WorkspaceSearchPage = {
  items: ['DOCUMENT', 'SOURCE', 'CONVERSATION', 'COMMENT', 'ANALYSIS'].map(
    (type, index) => ({
      type: type as 'DOCUMENT',
      id: String(index),
      title: `Research ${type}`,
      snippet: '<img src=x onerror=alert(1)> synthetic research result',
      location: `/app/workspaces/w/object/${String(index)}`,
      sourceVersion: index % 2 ? 'version-1' : null,
      updatedAt: '2026-10-13T10:00:00Z',
    }),
  ),
  nextCursor: 'next',
};
let client: QueryClient;
function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}
function mount(workspaceId: string | null = 'w', compact = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceCommandSearch
          workspaceId={workspaceId ?? undefined}
          compact={compact}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function query(text = 'research') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Search workspace' }), {
    target: { value: text },
  });
  await within(screen.getByRole('listbox')).findAllByRole('option', { selected: true });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(searchWorkspace).mockResolvedValue(results);
});
afterEach(() => {
  cleanup();
  client.clear();
});
it('searches five types with plain snippets, supports keyboard selection and deep links', async () => {
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Search workspace (Cmd or Ctrl K)' }),
  );
  await query();
  expect(await screen.findByText('5 results')).toBeTruthy();
  expect(document.querySelector('img[src=x]')).toBeNull();
  const input = screen.getByRole('combobox', { name: 'Search workspace' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(
    within(screen.getByRole('listbox')).getByRole('option', { selected: true })
      .textContent,
  ).toContain('SOURCE');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(
    within(screen.getByRole('listbox')).getByRole('option', { selected: true })
      .textContent,
  ).toContain('ANALYSIS');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('location').textContent).toBe('/app/workspaces/w/object/4');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('uses type filters and opaque next-page cursors and resets the cursor when query changes', async () => {
  mount('w', true);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  await query();
  fireEvent.click(screen.getByRole('button', { name: 'Next results' }));
  await waitFor(() =>
    expect(searchWorkspace).toHaveBeenCalledWith(
      'w',
      'research',
      [],
      'next',
      expect.any(AbortSignal),
    ),
  );
  fireEvent.change(screen.getByLabelText('Result type'), {
    target: { value: 'COMMENT' },
  });
  await waitFor(() =>
    expect(searchWorkspace).toHaveBeenCalledWith(
      'w',
      'research',
      ['COMMENT'],
      undefined,
      expect.any(AbortSignal),
    ),
  );
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search workspace' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not request per character, handles errors and empty results without stale snippets', async () => {
  jest
    .mocked(searchWorkspace)
    .mockRejectedValueOnce(new Error('denied'))
    .mockResolvedValue({ items: [], nextCursor: null });
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Search workspace (Cmd or Ctrl K)' }),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Search workspace' }), {
    target: { value: 'r' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search workspace' }), {
    target: { value: 'research' },
  });
  expect(searchWorkspace).not.toHaveBeenCalled();
  await screen.findByRole('alert');
  expect(screen.queryByText('Research SOURCE')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Search workspace' }), {
    target: { value: 'other' },
  });
  await screen.findByText('Nothing matches “other”');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search workspace' }), {
    key: 'Enter',
  });
  expect(screen.getByTestId('location').textContent).toBe('/');
});
it('uses mouse selection, double-click and prevents another modal from being interrupted', async () => {
  mount();
  const blocker = document.createElement('div');
  blocker.setAttribute('role', 'dialog');
  document.body.appendChild(blocker);
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  blocker.remove();
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  await query();
  const option = within(screen.getByRole('listbox')).getAllByRole('option', {
    selected: false,
  })[0]!;
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  fireEvent.doubleClick(option);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('disables the trigger outside an authorized workspace and ignores modified or composing keys', () => {
  mount(null);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps query markup inert and permits shortcut toggling without navigation', async () => {
  mount();
  for (const key of [
    { key: 'k', metaKey: true, altKey: true },
    { key: 'k', metaKey: true, shiftKey: true },
    { key: 'k', metaKey: true, repeat: true },
    { key: 'x', metaKey: true },
    { key: 'k' },
    { key: 'k', ctrlKey: true, isComposing: true },
  ])
    fireEvent.keyDown(document, key);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  await query('research.*');
  const input = screen.getByRole('combobox', { name: 'Search workspace' });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(screen.getByTestId('location').textContent).toBe('/');
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {});
});
it('previews beside the draft without navigating and opens the selected version only on demand', async () => {
  mount();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  await query();
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search workspace' }), {
    key: 'Enter',
    ctrlKey: true,
  });
  expect(screen.getByTestId('location').textContent).toBe('/');
  expect(screen.getByText(/opened beside your current page/)).toBeTruthy();
  expect(screen.getByText('Version: not versioned')).toBeTruthy();
  expect(document.querySelector('img[src=x]')).toBeNull();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
  await query();
  const input = screen.getByRole('combobox', { name: 'Search workspace' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(screen.getByText('Version: version-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
  expect(screen.getByTestId('location').textContent).toBe('/app/workspaces/w/object/1');
});
