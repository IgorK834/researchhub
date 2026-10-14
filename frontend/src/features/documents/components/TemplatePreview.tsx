import type { ReactElement } from 'react';
import type { DocumentTemplate } from '../api/documentTemplateApi';
import { useI18n } from '../../../shared/i18n';
import { readStoredDocument } from '../api/documentContent';
import styles from './TemplatePreview.module.css';

export function TemplatePreview({
  template,
}: {
  readonly template: DocumentTemplate;
}): ReactElement {
  const { t } = useI18n();
  const content = readStoredDocument(template.content);
  if (!content) return <p role="alert">{t('templates.error')}</p>;
  return (
    <section aria-label={t('templates.preview')} className={styles.preview}>
      <strong>{template.title}</strong> ·{' '}
      {t('templates.version', { version: template.version })}
      <p>{template.description}</p>
      <p>{t('templates.guidance')}</p>
      <div
        role="document"
        tabIndex={0}
        aria-label={t('templates.preview')}
        className={styles.structure}
      >
        {(content.content ?? []).map((node, index) =>
          node.type === 'heading' ? (
            <h3 key={index}>{node.content?.map((part) => part.text).join('')}</h3>
          ) : (
            <p key={index}>
              <em>{node.content?.map((part) => part.text).join('')}</em>
            </p>
          ),
        )}
      </div>
      <details>
        <summary>{t('templates.required')}</summary>
        <ul>
          {template.requiredPlaceholders.map((prompt) => (
            <li key={prompt.id}>{prompt.hint}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
