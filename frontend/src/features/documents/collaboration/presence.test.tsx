/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { DocumentPresence } from '../components/DocumentPresence';
import { collaborators, renderCaret, renderSelection } from './presence';
import { avatarTone } from '../../../shared/components/identity';
it('deduplicates tabs and renders only active people, collapsing larger groups without exposing email', () => {
  const states = [
    { user: { userId: 'one', displayName: 'Ada', email: 'private@test' } },
    { user: { userId: 'one', displayName: 'Ada' } },
    { user: null },
    {},
    { user: 3 },
    { user: { userId: 2, displayName: 'Invalid' } },
    { user: { userId: 'blank', displayName: ' ' } },
  ];
  const people = collaborators(states);
  expect(people).toEqual([
    { userId: 'one', displayName: 'Ada', colorId: avatarTone('one') },
  ]);
  const view = render(<DocumentPresence people={people} />);
  expect(screen.queryByRole('group')).toBeNull();
  view.rerender(
    <DocumentPresence
      people={collaborators(
        Array.from({ length: 6 }, (_, i) => ({
          user: { userId: `user-${i}`, displayName: `Author ${i}` },
        })),
      )}
    />,
  );
  expect(
    screen.getByRole('group', { name: 'In this document now' }).children,
  ).toHaveLength(4);
  expect(screen.getByText('+3')).not.toBeNull();
  expect(view.container.textContent).not.toContain('private@test');
  view.rerender(<DocumentPresence people={[]} />);
  expect(screen.queryByRole('group')).toBeNull();
});
it('builds text-safe caret labels and tinted selections from the fixed brand palette', () => {
  const user = {
    userId: 'one',
    displayName: '<img src=x onerror=alert(1)>',
    colorId: 'mint' as const,
  };
  const caret = renderCaret(user);
  expect(caret.querySelector('img')).toBeNull();
  expect(caret.textContent).toBe(user.displayName);
  expect(caret.style.borderColor).toBe('rgb(183, 231, 193)');
  expect(renderSelection(user)).toEqual({
    class: 'collaboration-carets__selection',
    style: 'background-color: #b7e7c155',
    'data-collaborator': 'one',
  });
});
