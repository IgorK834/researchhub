/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SourceSearchDialog, MatchedText } from './SourceSearchDialog';
import { searchSourceText } from '../api/sourceTextSearch';
import { textHit } from '../testing/searchFixtures';
jest.mock('../api/sourceTextSearch', () => ({
  ...jest.requireActual('../api/sourceTextSearch'),
  searchSourceText: jest.fn(),
}));
const search = jest.mocked(searchSourceText);
const opened = jest.fn(),
  closed = jest.fn();
function mount(titles = new Map([['s1', 'smith_2025.pdf']])) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SourceSearchDialog
        workspaceId="w1"
        titles={titles}
        onOpen={opened}
        onClose={closed}
      />
    </QueryClientProvider>,
  );
}
async function type(value = 'temperature efficiency') {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  await waitFor(() => expect(search).toHaveBeenCalled());
}
beforeEach(() => {
  jest.clearAllMocks();
  search.mockResolvedValue([
    textHit(),
    {
      ...textHit('c2', 22),
      chunk: {
        ...textHit('c2', 22).chunk,
        content: 'Efficiency depends on temperature. Second passage.',
      },
    },
  ]);
});
it('focuses the input, announces counts, highlights inert passage text and updates a preview with arrows', async () => {
  mount();
  const input = screen.getByRole('combobox');
  expect(document.activeElement).toBe(input);
  expect(screen.getAllByText('Esc')).toHaveLength(2);
  await type();
  await screen.findByText('2 results in workspace sources');
  expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Source passages');
  expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('complementary').textContent).toContain('page 14');
  expect(document.querySelectorAll('mark').length).toBeGreaterThan(1);
  expect(document.querySelector('img[src="x"]')).toBeNull();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('complementary').textContent).toContain('page 22');
  expect(input.getAttribute('aria-activedescendant')).toBe(
    screen.getAllByRole('option')[1]!.id,
  );
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('complementary').textContent).toContain('page 14');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(screen.getByRole('complementary').textContent).toContain('page 22');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(opened).toHaveBeenLastCalledWith(
    expect.objectContaining({ chunk: expect.objectContaining({ chunkId: 'c2' }) }),
    false,
  );
});
it('supports Cmd/Ctrl Enter, mouse selection, double click and the explicit Open page action', async () => {
  mount();
  await type();
  await screen.findAllByRole('option');
  const input = screen.getByRole('combobox');
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(opened).toHaveBeenLastCalledWith(textHit(), true);
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(opened).toHaveBeenLastCalledWith(textHit(), true);
  const row = screen.getAllByRole('option')[1]!;
  fireEvent.mouseDown(row);
  fireEvent.click(row);
  expect(document.activeElement).toBe(input);
  fireEvent.doubleClick(row);
  expect(opened).toHaveBeenLastCalledWith(
    expect.objectContaining({ chunk: expect.objectContaining({ chunkId: 'c2' }) }),
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }), { ctrlKey: true });
  expect(opened).toHaveBeenLastCalledWith(expect.anything(), true);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(closed).toHaveBeenCalled();
});
it('provides the sources-only and clear actions in the announced empty state', async () => {
  search.mockResolvedValue([]);
  mount();
  await type('thermal drift');
  await screen.findByRole('heading', { name: 'Nothing matches “thermal drift”' });
  expect(screen.getByRole('status').textContent).toContain(
    '0 results in workspace sources',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Search sources only' }));
  expect(document.activeElement).toBe(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('status').textContent).toContain('Enter a phrase');
  expect(screen.queryByRole('option')).toBeNull();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(opened).not.toHaveBeenCalled();
});
it('shows retrieval failures and retries without displaying old or out-of-scope results', async () => {
  search.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  await type();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not search source text: An unexpected error occurred',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
  await screen.findAllByRole('option');
  search.mockResolvedValue([]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'new query' } });
  expect(screen.queryByRole('option')).toBeNull();
  await screen.findByRole('heading', { name: 'Nothing matches “new query”' });
});
it('keeps loading distinct from no results, respects composition and leaves button keys to buttons', async () => {
  let resolve!: (hits: readonly ReturnType<typeof textHit>[]) => void;
  search.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount(new Map());
  await type('solar');
  expect(screen.getByRole('status').textContent).toContain('Searching');
  expect(screen.queryByText(/Nothing matches/)).toBeNull();
  resolve([textHit()]);
  await screen.findByRole('option');
  expect(screen.getByRole('complementary').textContent).toContain('Workspace source');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', isComposing: true });
  expect(opened).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Open page' }), {
    key: 'ArrowDown',
  });
  expect(opened).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'x' });
  expect(opened).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
  expect(opened).toHaveBeenLastCalledWith(textHit(), false);
});
it('highlights literal regex punctuation without interpreting source markup', () => {
  const view = render(
    <MatchedText text="<script> a+b C++ a+b </script>" query="a+b C++ a+b" />,
  );
  expect(view.container.querySelectorAll('mark')).toHaveLength(3);
  expect(view.container.querySelector('script')).toBeNull();
  view.rerender(<MatchedText text="plain" query=" " />);
  expect(view.container.textContent).toContain('plain');
});

it('clears old passages immediately when the input is erased without announcing a stale empty search', async () => {
  mount();
  await type();
  await screen.findAllByRole('option');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(screen.queryByText(/Nothing matches/)).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Enter a phrase');
});
