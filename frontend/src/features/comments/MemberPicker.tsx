import { useId, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { memberApi, type WorkspacePerson } from './memberApi';
import { t, useLocale } from '../../shared/i18n';
import { describeError } from '../../shared/api';
import styles from './Mentions.module.css';

export function MemberPicker({
  workspaceId,
  onSelect,
  label = t('collab.member'),
}: {
  readonly workspaceId: string;
  readonly onSelect: (person: WorkspacePerson) => void;
  readonly label?: string;
}): ReactElement {
  useLocale();
  const id = useId(),
    [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const members = useQuery({
    queryKey: ['workspace-people', workspaceId, query],
    queryFn: () => memberApi.search(workspaceId, query),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const rows = members.error ? [] : (members.data ?? []);
  const select = (person: WorkspacePerson): void => {
    onSelect(person);
    setQuery('');
    setOpen(false);
    setActive(0);
  };
  return (
    <div className={styles.picker}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        maxLength={80}
        value={query}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && rows[active] ? `${id}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              rows.length === 0
                ? 0
                : (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length,
            );
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (rows[active]) select(rows[active]);
          }
        }}
      />
      {open ? (
        <div>
          {members.isPending ? <p role="status">{t('collab.loading')}</p> : null}
          {members.error ? <p role="alert">{describeError(members.error)}</p> : null}
          {members.isSuccess && rows.length === 0 ? (
            <p role="status">{t('collab.noMembers')}</p>
          ) : null}
          <ul id={`${id}-list`} role="listbox" aria-label={label}>
            {rows.map((person, i) => (
              <li
                key={person.userId}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(person)}
                >
                  {person.displayLabel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
