import { avatarTone, type BrandTone } from '../../../shared/components/identity';

/** The complete public awareness identity. Email and account details are deliberately absent. */
export interface Collaborator {
  readonly userId: string;
  readonly displayName: string;
  readonly colorId: BrandTone;
}
const colors: Record<BrandTone, string> = {
  blue: '#8cc8ff',
  coral: '#ff8f87',
  lavender: '#ddb8ff',
  mint: '#b7e7c1',
  yellow: '#ffd166',
};
export function presenceColor(user: Collaborator): string {
  return colors[user.colorId];
}
export function collaborators(
  states: readonly Record<string, unknown>[],
): Collaborator[] {
  const people = new Map<string, Collaborator>();
  for (const { user } of states) {
    if (user === null || typeof user !== 'object') continue;
    const identity = user as Partial<Collaborator>;
    if (
      typeof identity.userId !== 'string' ||
      typeof identity.displayName !== 'string' ||
      !identity.displayName.trim()
    )
      continue;
    people.set(identity.userId, {
      userId: identity.userId,
      displayName: identity.displayName,
      colorId: avatarTone(identity.userId),
    });
  }
  return Array.from(people.values()).sort((a, b) => a.userId.localeCompare(b.userId));
}
export function renderCaret(user: Collaborator): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'collaboration-carets__caret';
  caret.style.borderColor = presenceColor(user);
  caret.contentEditable = 'false';
  const label = document.createElement('span');
  label.className = 'collaboration-carets__label';
  label.style.backgroundColor = presenceColor(user);
  label.textContent = user.displayName;
  caret.appendChild(label);
  return caret;
}
export function renderSelection(user: Collaborator): Record<string, string> {
  return {
    class: 'collaboration-carets__selection',
    style: `background-color: ${presenceColor(user)}55`,
    'data-collaborator': user.userId,
  };
}
