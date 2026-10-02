import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { Icon } from '../icons';
import styles from './Navigation.module.css';

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
  readonly content: ReactNode;
}
export interface TabsProps<T extends string> {
  readonly label: string;
  readonly items: readonly TabItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly orientation?: 'horizontal' | 'vertical';
}
/** Automatic activation for local panels; route navigation remains a separate concern. */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  orientation = 'horizontal',
}: TabsProps<T>): ReactElement {
  const id = useId();
  const enabled = items.filter((item) => !item.disabled);
  const selected =
    enabled.find((item) => item.value === value)?.value ?? enabled[0]?.value;
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
        className={[styles.tabs, styles[orientation]].join(' ')}
      >
        {items.map((item, index) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={item.value === selected}
            disabled={item.disabled}
            tabIndex={item.value === selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
              const previousKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
              if (
                ![nextKey, previousKey, 'Home', 'End'].includes(event.key) ||
                enabled.length === 0
              )
                return;
              event.preventDefault();
              const current = enabled.findIndex(
                (candidate) => candidate.value === item.value,
              );
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? enabled.length - 1
                    : (current + (event.key === nextKey ? 1 : -1) + enabled.length) %
                      enabled.length;
              const next = enabled[nextIndex]!;
              onChange(next.value);
              const buttons = Array.from(
                event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              ).filter((button) => !button.disabled);
              buttons[nextIndex]!.focus();
            }}
          >
            {item.label}
            {item.count === undefined ? null : (
              <span className={styles.count}> {item.count}</span>
            )}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.value}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          tabIndex={0}
          hidden={item.value !== selected}
          className={styles.tabPanel}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

export interface FilterChipProps extends Omit<
  ComponentProps<'button'>,
  'children' | 'aria-pressed'
> {
  readonly label: string;
  readonly count?: number;
  readonly active: boolean;
}
export function FilterChip({
  label,
  count,
  active,
  className,
  type = 'button',
  ...props
}: FilterChipProps): ReactElement {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={active}
      className={[styles.filter, className].filter(Boolean).join(' ')}
    >
      {label}
      {count === undefined ? null : <span> {count}</span>}
    </button>
  );
}

export interface BreadcrumbSegment {
  readonly label: string;
  readonly href?: string;
}
export interface BreadcrumbProps {
  readonly segments: readonly BreadcrumbSegment[];
  readonly label?: string;
  readonly renderLink?: (
    segment: BreadcrumbSegment & { readonly href: string },
  ) => ReactNode;
}
export function Breadcrumb({
  segments,
  label = 'Breadcrumb',
  renderLink,
}: BreadcrumbProps): ReactElement {
  return (
    <nav aria-label={label} className={styles.breadcrumb}>
      <ol>
        {segments.map((segment, index) => {
          const last = index === segments.length - 1;
          return (
            <li key={`${index}-${segment.label}`}>
              {index === 0 ? null : <Icon name="chevRight" size={14} />}
              {last ? (
                <span aria-current="page" title={segment.label}>
                  {segment.label}
                </span>
              ) : segment.href === undefined ? (
                <span title={segment.label}>{segment.label}</span>
              ) : renderLink ? (
                renderLink({ ...segment, href: segment.href })
              ) : (
                <a href={segment.href} title={segment.label}>
                  {segment.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
