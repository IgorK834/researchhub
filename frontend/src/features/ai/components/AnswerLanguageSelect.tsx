import type { ReactElement } from 'react';
import { useI18n, type Locale } from '../../../shared/i18n';
import { Select } from '../../../shared/components/forms';

/** Content language is an explicit per-request choice, never coupled to the UI locale. */
export function AnswerLanguageSelect({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: Locale;
  readonly onChange: (locale: Locale) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const { t } = useI18n();
  return (
    <div>
      <Select
        label={t('ai.answerLanguage')}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Locale)}
      >
        <option value="en">English</option>
        <option value="pl">Polski</option>
      </Select>
      <small>{t('ai.answerLanguageHint')}</small>
    </div>
  );
}
