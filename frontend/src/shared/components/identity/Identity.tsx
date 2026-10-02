import type { ReactElement } from 'react';

import { Button } from '../Button';
import { Icon, type IconName } from '../icons';
import styles from './Identity.module.css';

export type BrandTone = 'blue' | 'coral' | 'lavender' | 'mint' | 'yellow';
export type BadgeTone = BrandTone | 'neutral' | 'ink';
export interface BadgeProps {
  readonly label: string;
  readonly icon: IconName;
  readonly tone?: BadgeTone;
  readonly variant?: 'mid' | 'outlined';
  readonly size?: 'default' | 'compact';
  readonly className?: string;
}

/** A visible word and a decorative icon are mandatory; tone alone never communicates state. */
export function Badge({
  label,
  icon,
  tone = 'neutral',
  variant = 'mid',
  size = 'default',
  className,
}: BadgeProps): ReactElement {
  if (!label.trim()) throw new Error('Badge requires a non-empty visible label.');
  return (
    <span
      className={[styles.badge, styles[tone], styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon} size={14} />
      {label}
    </span>
  );
}

export interface ChipProps extends BadgeProps {
  readonly onRemove?: () => void;
}
export function Chip({ onRemove, ...props }: ChipProps): ReactElement {
  return (
    <span className={styles.chip}>
      <Badge {...props} />
      {onRemove ? (
        <Button
          variant="ghost"
          size="compact"
          iconOnly
          icon="x"
          aria-label={`Remove ${props.label}`}
          onClick={onRemove}
          className={styles.remove}
        />
      ) : null}
    </span>
  );
}

export interface AvatarPerson {
  readonly userId: string;
  readonly name: string;
}
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
const tones: readonly BrandTone[] = ['blue', 'coral', 'lavender', 'mint', 'yellow'];

/** Stable FNV-1a hash, independent of render order and names. Not a security identifier. */
export function avatarTone(userId: string): BrandTone {
  let hash = 2166136261;
  for (const character of userId) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return tones[(hash >>> 0) % tones.length]!;
}
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return [
    Array.from(words[0]!)[0],
    words.length > 1 ? Array.from(words[words.length - 1]!)[0] : undefined,
  ]
    .join('')
    .toLocaleUpperCase('en');
}

export function Avatar({
  userId,
  name,
  size = 'md',
}: AvatarPerson & { readonly size?: AvatarSize }): ReactElement {
  return (
    <span
      role="img"
      aria-label={name.trim() || 'Unknown person'}
      className={[styles.avatar, styles[avatarTone(userId)], styles[size]].join(' ')}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}

export interface AvatarStackProps {
  readonly people: readonly AvatarPerson[];
  /** Number of named avatars before a separate +N circle; positive integer. */
  readonly limit?: number;
  readonly size?: AvatarSize;
  readonly label?: string;
}
export function AvatarStack({
  people,
  limit = 3,
  size = 'sm',
  label = 'People',
}: AvatarStackProps): ReactElement {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('AvatarStack limit must be a positive integer.');
  const visible = people.slice(0, limit);
  const rest = people.slice(limit);
  return (
    <span role="group" aria-label={label} className={styles.stack}>
      {visible.map((person) => (
        <Avatar key={person.userId} {...person} size={size} />
      ))}
      {rest.length > 0 ? (
        <span
          role="img"
          aria-label={`${rest.length} more people: ${rest.map((person) => person.name).join(', ')}`}
          className={[styles.avatar, styles.overflow, styles[size]].join(' ')}
        >
          <span aria-hidden="true">+{rest.length}</span>
        </span>
      ) : null}
    </span>
  );
}

export function Sticker({
  label,
  tone = 'yellow',
  icon,
}: {
  readonly label: string;
  readonly tone?: BrandTone;
  readonly icon?: IconName;
}): ReactElement {
  if (!label.trim()) throw new Error('Sticker requires a non-empty visible label.');
  return (
    <span className={[styles.sticker, styles[tone]].join(' ')}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {label}
    </span>
  );
}
