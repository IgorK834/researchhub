/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemberPicker } from './MemberPicker';
import { MentionComposer, MentionLabels } from './MentionComposer';
import { EditComment } from './EditComment';
import {
  memberApi,
  retainMentions,
  replaceMentionRanges,
  canonicalMentions,
  type Mention,
} from './memberApi';
import { commentApi, type DocumentComment } from '../documents/comments/commentApi';
import { setLocale } from '../../shared/i18n';
jest.mock('./memberApi', () => ({
  ...jest.requireActual('./memberApi'),
  memberApi: { search: jest.fn() },
}));
jest.mock('../documents/comments/commentApi', () => ({
  commentApi: { edit: jest.fn() },
}));
const ada = { userId: 'ada', displayLabel: 'Ada' },
  ben = { userId: 'ben', displayLabel: '<Ben>' };
const mention: Mention = { ...ada, start: 0, end: 4 };
let client: QueryClient;
function wrap(child: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
}
beforeEach(() => {
  setLocale('en');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.mocked(memberApi.search).mockResolvedValue([ada, ben]);
  jest.mocked(commentApi.edit).mockResolvedValue({} as DocumentComment);
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
});
it('uses keyboard navigation and explicit current-user selection', async () => {
  const selected = jest.fn();
  wrap(<MemberPicker workspaceId="w" onSelect={selected} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  await screen.findByRole('option', { name: 'Ada' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.getAttribute('aria-activedescendant')).toContain('-1');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(selected).toHaveBeenCalledWith(ben);
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input.getAttribute('aria-expanded')).toBe('false');
  fireEvent.change(input, { target: { value: 'Ada' } });
  await waitFor(() => expect(memberApi.search).toHaveBeenCalledWith('w', 'Ada'));
  await screen.findByRole('option', { name: 'Ada' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(selected).toHaveBeenLastCalledWith(ada);
});
it('does not expose HTML, supports mouse choice and closes on blur', async () => {
  const selected = jest.fn();
  wrap(<MemberPicker workspaceId="w" label="Assignee" onSelect={selected} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  const button = await screen.findByRole('button', { name: '<Ben>' });
  expect(document.querySelector('ben')).toBeNull();
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  expect(selected).toHaveBeenCalledWith(ben);
  fireEvent.focus(input);
  fireEvent.blur(input);
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('handles loading, no matches, empty keyboard navigation and errors', async () => {
  jest.mocked(memberApi.search).mockResolvedValue([]);
  wrap(<MemberPicker workspaceId="w" onSelect={jest.fn()} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  await screen.findByText('No matching members.');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  jest.mocked(memberApi.search).mockRejectedValue(new Error('revoked'));
  fireEvent.change(input, { target: { value: 'gone' } });
  await screen.findByRole('alert');
});
it('inserts typed ranges at the caret and keeps plain @ai text separate', async () => {
  const change = jest.fn();
  wrap(
    <MentionComposer
      workspaceId="w"
      id="body"
      label="Body"
      body="Review @ai "
      mentions={[]}
      onChange={change}
    />,
  );
  const textarea = screen.getByLabelText('Body') as HTMLTextAreaElement;
  textarea.setSelectionRange(11, 11);
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
  expect(change).toHaveBeenCalledWith('Review @ai @Ada ', [
    { ...ada, start: 11, end: 15 },
  ]);
  expect(document.activeElement).toBe(textarea);
  fireEvent.change(textarea, { target: { value: 'Only @email' } });
  expect(change).toHaveBeenLastCalledWith('Only @email', []);
});
it('does not exceed comment limits and supports disabled and removed-member states', async () => {
  const change = jest.fn();
  const view = wrap(
    <MentionComposer
      workspaceId="w"
      id="body"
      label="Body"
      body={'a'.repeat(3999)}
      mentions={[]}
      onChange={change}
    />,
  );
  (screen.getByLabelText('Body') as HTMLTextAreaElement).setSelectionRange(3999, 3999);
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
  expect(change).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={client}>
      <MentionComposer
        workspaceId="w"
        id="body"
        label="Body"
        body=""
        mentions={[]}
        onChange={change}
        disabled
      />
      <MentionLabels mentions={[mention, { ...mention, available: false }]} />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('@Removed member')).toBeTruthy();
});
it('edits a comment with expected revision, cancellation and errors', async () => {
  const comment = {
    id: 'c',
    workspaceId: 'w',
    documentId: 'd',
    revision: 3,
    body: '@Ada',
    mentions: [mention],
  } as unknown as DocumentComment;
  wrap(<EditComment comment={comment} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
  fireEvent.change(screen.getByLabelText('Comment text'), {
    target: { value: '@Ada please' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(commentApi.edit).toHaveBeenCalledWith('w', 'd', 'c', 3, '@Ada please', [
      mention,
    ]),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  jest.mocked(commentApi.edit).mockRejectedValue(new Error('Conflict'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});
it('preserves, shifts, removes ranges and canonicalizes leading whitespace without parsing text', () => {
  expect(retainMentions('@Ada says', '@Ada said', [mention])).toEqual([mention]);
  expect(retainMentions('@Ada', 'Hi @Ada', [mention])).toEqual([
    { ...mention, start: 3, end: 7 },
  ]);
  expect(retainMentions('@Ada', '@Ben', [mention])).toEqual([]);
  expect(retainMentions('@Ada', '@Ada', [mention])).toEqual([mention]);
  expect(canonicalMentions('  @Ada ', [{ ...mention, start: 2, end: 6 }])).toEqual([
    mention,
  ]);
});

it('replaces a selected mention with a different user who has the same label', async () => {
  const other = { userId: 'other-ada', displayLabel: 'Ada' },
    change = jest.fn();
  jest.mocked(memberApi.search).mockResolvedValue([other]);
  wrap(
    <MentionComposer
      workspaceId="w"
      id="body"
      label="Body"
      body="@Ada"
      mentions={[mention]}
      onChange={change}
    />,
  );
  (screen.getByLabelText('Body') as HTMLTextAreaElement).setSelectionRange(0, 4);
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: 'Ada' }));
  expect(change).toHaveBeenCalledWith('@Ada ', [{ ...other, start: 0, end: 4 }]);
  expect(replaceMentionRanges([mention], 4, 4, 5)).toEqual([mention]);
  expect(replaceMentionRanges([mention], 0, 0, 5)).toEqual([
    { ...mention, start: 5, end: 9 },
  ]);
});
