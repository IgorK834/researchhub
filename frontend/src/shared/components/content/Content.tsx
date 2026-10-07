import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { Icon, type IconName } from '../icons';
import type { BrandTone } from '../identity';
import styles from './Content.module.css';
import { useNarrowDesktop } from '../../hooks/useNarrowDesktop';
import { visibleTableColumns } from './tableColumns';

export function Card({ className, ...props }: ComponentProps<'div'>): ReactElement {
  return (
    <div {...props} className={[styles.card, className].filter(Boolean).join(' ')} />
  );
}

export interface PanelProps {
  readonly title: string;
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}
export function Panel({
  title,
  header,
  footer,
  children,
  className,
}: PanelProps): ReactElement {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={[styles.card, styles.panel, className].filter(Boolean).join(' ')}
    >
      <header className={styles.panelHeader}>
        <h2 id={id}>{title}</h2>
        {header}
      </header>
      <div className={styles.panelBody}>{children}</div>
      {footer === undefined ? null : (
        <footer className={styles.panelFooter}>{footer}</footer>
      )}
    </section>
  );
}

/** A quiet annotation, with words alongside a decorative icon. */
export function DashedNote({
  children,
  icon = 'info',
}: {
  readonly children: ReactNode;
  readonly icon?: IconName;
}): ReactElement {
  return (
    <div className={styles.note}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function IconTile({
  icon,
  tone = 'blue',
  size = 'default',
  fill = 'mid',
}: {
  readonly icon: IconName;
  readonly tone?: BrandTone;
  readonly size?: 'small' | 'default' | 'large';
  readonly fill?: 'mid' | 'base';
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={[
        styles.tile,
        styles[tone],
        styles[size],
        fill === 'base' ? styles.tileBase : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={icon} size={size === 'small' ? 16 : 20} />
    </span>
  );
}

export interface ListRowProps extends Omit<ComponentProps<'li'>, 'title'> {
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly actions?: ReactNode;
  readonly selected?: boolean;
}
/** Keep navigation in a title link and actions in named buttons, rather than nesting controls. */
export function ListRow({
  title,
  meta,
  leading,
  trailing,
  actions,
  selected = false,
  className,
  ...props
}: ListRowProps): ReactElement {
  return (
    <li
      {...props}
      data-selected={selected || undefined}
      className={[styles.row, className].filter(Boolean).join(' ')}
    >
      {leading}
      <div className={styles.rowText}>
        <div className={styles.rowTitle}>
          {title}
          {selected ? <span className="visually-hidden"> (selected)</span> : null}
        </div>
        {meta === undefined ? null : <div className={styles.meta}>{meta}</div>}
      </div>
      {trailing}
      {actions === undefined ? null : <div className={styles.rowActions}>{actions}</div>}
    </li>
  );
}

export interface TableColumn<Row> {
  readonly id: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  readonly rowHeader?: boolean;
  readonly priority?: 'essential' | 'metadata';
}
export interface DataTableProps<Row> {
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string | number;
  readonly caption: string;
  readonly label?: string;
  readonly scrollLabel?: string;
  readonly isSelected?: (row: Row) => boolean;
  readonly footer?: ReactNode;
}
/** Native table semantics. Sorting, selection controls and cell actions belong to consumers. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  label = caption,
  scrollLabel = `${label} table`,
  isSelected,
  footer,
}: DataTableProps<Row>): ReactElement {
  const narrow = useNarrowDesktop();
  const visible = visibleTableColumns(columns, narrow);
  if (visible.length === 0)
    throw new Error('DataTable requires at least one column visible at this width.');
  return (
    <div className={styles.tableCard}>
      <div
        role="region"
        aria-label={scrollLabel}
        tabIndex={0}
        className={styles.tableScroll}
      >
        <table aria-label={label} className={styles.table}>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {visible.map((column) => (
                <th key={column.id} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = isSelected?.(row) ?? false;
              return (
                <tr key={rowKey(row)} data-selected={selected || undefined}>
                  {visible.map((column, index) => {
                    const Cell = column.rowHeader ? 'th' : 'td';
                    return (
                      <Cell key={column.id} scope={column.rowHeader ? 'row' : undefined}>
                        {column.render(row)}
                        {selected && index === 0 ? (
                          <span className="visually-hidden"> (selected)</span>
                        ) : null}
                      </Cell>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer === undefined ? null : <div className={styles.tableFooter}>{footer}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly context?: string;
  readonly art?: ReactNode;
  readonly tone?: BrandTone;
  readonly size?: 'default' | 'compact';
  readonly actions?: readonly [ReactElement] | readonly [ReactElement, ReactElement];
  readonly headingLevel?: 'h2' | 'h3';
}
export function EmptyState({
  title,
  description,
  context,
  art,
  tone = 'mint',
  size = 'default',
  actions,
  headingLevel: Heading = 'h2',
}: EmptyStateProps): ReactElement {
  const id = useId();
  if (actions && actions.length > 2)
    throw new Error('EmptyState supports at most two actions.');
  return (
    <section
      aria-labelledby={id}
      className={[styles.empty, size === 'compact' ? styles.emptyCompact : '']
        .filter(Boolean)
        .join(' ')}
    >
      {art === undefined ? null : (
        <div aria-hidden="true" className={[styles.art, styles[tone]].join(' ')}>
          {art}
        </div>
      )}
      {context === undefined ? null : <p className={styles.context}>{context}</p>}
      <Heading id={id}>{title}</Heading>
      <p className={styles.description}>{description}</p>
      {actions === undefined ? null : (
        <div className={styles.actions}>
          {actions.map((action, index) => (
            <span key={index}>{action}</span>
          ))}
        </div>
      )}
    </section>
  );
}

export function Keycap({ children, ...props }: ComponentProps<'kbd'>): ReactElement {
  return (
    <kbd
      {...props}
      className={[styles.keycap, props.className].filter(Boolean).join(' ')}
    >
      {children}
    </kbd>
  );
}
export interface KeyboardHint {
  readonly keys: readonly string[];
  readonly label: string;
}
/** Informational hints only: consumers must implement the shortcuts they advertise. */
export function KeyboardHintBar({
  hints,
  label = 'Keyboard shortcuts',
}: {
  readonly hints: readonly KeyboardHint[];
  readonly label?: string;
}): ReactElement {
  return (
    <ul aria-label={label} className={styles.hints}>
      {hints.map((hint) => (
        <li key={hint.label}>
          {hint.keys.map((key) => (
            <Keycap key={key}>{key}</Keycap>
          ))}
          <span>{hint.label}</span>
        </li>
      ))}
    </ul>
  );
}
