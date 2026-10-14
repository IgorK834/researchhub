import { useRef, type ReactElement, type RefObject } from 'react';
import { MemberPicker } from './MemberPicker';
import { retainMentions, replaceMentionRanges, type Mention } from './memberApi';
import { t, useLocale } from '../../shared/i18n';
import styles from './Mentions.module.css';
export function MentionComposer({
  workspaceId,
  id,
  label,
  body,
  mentions,
  onChange,
  disabled = false,
  autoFocus = false,
  inputRef,
}: {
  readonly workspaceId: string;
  readonly id: string;
  readonly label: string;
  readonly body: string;
  readonly mentions: readonly Mention[];
  readonly onChange: (body: string, mentions: Mention[]) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>;
}): ReactElement {
  useLocale();
  const localInput = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? localInput;
  return (
    <div className={styles.composer}>
      <label htmlFor={id}>{label}</label>
      <textarea
        ref={input}
        id={id}
        value={body}
        rows={4}
        maxLength={4000}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) =>
          onChange(e.target.value, retainMentions(body, e.target.value, mentions))
        }
      />
      {!disabled ? (
        <MemberPicker
          workspaceId={workspaceId}
          label={t('collab.mentionMember')}
          onSelect={(person) => {
            const start = input.current?.selectionStart ?? body.length,
              end = input.current?.selectionEnd ?? start;
            const token = `@${person.displayLabel}`,
              after = `${body.slice(0, start)}${token} ${body.slice(end)}`;
            if (after.length > 4000) return;
            onChange(
              after,
              [
                ...replaceMentionRanges(mentions, start, end, token.length + 1),
                { ...person, start, end: start + token.length },
              ].sort((a, b) => a.start - b.start),
            );
            input.current?.focus();
            requestAnimationFrame(() =>
              input.current?.setSelectionRange(
                start + token.length + 1,
                start + token.length + 1,
              ),
            );
          }}
        />
      ) : null}
      <p className={styles.hint}>{t('collab.aiSeparate')}</p>
    </div>
  );
}
export function MentionLabels({
  mentions,
}: {
  readonly mentions: readonly Mention[];
}): ReactElement {
  useLocale();
  return (
    <span>
      {mentions.map((m, i) => (
        <span className={styles.chip} key={`${m.userId}-${i}`}>
          @{m.available === false ? t('collab.removedMember') : m.displayLabel}
        </span>
      ))}
    </span>
  );
}
