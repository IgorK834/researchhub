import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { createElement, useMemo, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import type { ProseMirrorDocument } from '../api/documentContent';
import { compareStoredDocuments, type DocumentDiffNode } from '../api/documentDiff';
import type { EditorCitation } from '../api/researchCitation';
import { isAnalysisBlockAttrs } from '../api/analysisReference';
import styles from './DocumentHistory.module.css';
import paper from './DocumentPaper.module.css';

function renderNode(
  { node, change, children }: DocumentDiffNode,
  key: number,
): ReactNode {
  const content = children.map(renderNode);
  const props = { key, 'data-change': change };
  if (node.type === 'text') {
    let text: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      const tag = {
        bold: 'strong',
        italic: 'em',
        strike: 's',
        code: 'code',
        underline: 'u',
      }[mark.type];
      if (tag) text = createElement(tag, null, text);
    }
    return createElement(
      change === 'added' ? 'ins' : change === 'removed' ? 'del' : 'span',
      props,
      text,
    );
  }
  if (node.type === 'researchCitation') {
    const citation = node.attrs?.['citation'] as EditorCitation;
    return (
      <span {...props} className={styles.citation} title={citation.title ?? undefined}>
        {citation.label ?? citation.title ?? uiText('ui.ResearchEvidence.message001')}
      </span>
    );
  }
  if (node.type === 'analysisResult' && isAnalysisBlockAttrs(node.attrs))
    return (
      <div {...props}>
        {uiText('ui.DocumentVersionDiff.message001')}{' '}
        {node.attrs.caption || node.attrs.reference.outputId}{' '}
        {uiText('ui.DocumentAnalysisBlock.message009')} {node.attrs.reference.executionId}{' '}
        · {node.attrs.reference.renderMode.toLowerCase()}
      </div>
    );
  if (node.type === 'hardBreak')
    return (
      <span {...props}>
        <br />
        <span className="visually-hidden">
          {uiText('ui.DocumentVersionDiff.message002')}
        </span>
      </span>
    );
  if (node.type === 'horizontalRule')
    return (
      <div {...props}>
        <hr />
      </div>
    );
  const tag =
    node.type === 'heading'
      ? `h${String(node.attrs?.['level'] ?? 2)}`
      : ({
          paragraph: 'p',
          bulletList: 'ul',
          orderedList: 'ol',
          listItem: 'li',
          blockquote: 'blockquote',
          codeBlock: 'pre',
          table: 'table',
          tableRow: 'tr',
          tableCell: 'td',
          tableHeader: 'th',
          figure: 'figure',
          figureCaption: 'figcaption',
        }[node.type ?? ''] ?? 'div');
  return createElement(
    tag,
    {
      ...props,
      ...(tag === 'ol' ? { start: node.attrs?.['start'] } : {}),
      ...(tag === 'td' || tag === 'th'
        ? { colSpan: node.attrs?.['colspan'], rowSpan: node.attrs?.['rowspan'] }
        : {}),
    },
    tag === 'table' ? <tbody>{content}</tbody> : content,
  );
}

export interface DocumentVersionDiffProps {
  readonly selected: ProseMirrorDocument;
  readonly current: ProseMirrorDocument;
  readonly selectedRevision: number;
  readonly currentRevision: number;
  readonly title: string;
  readonly onClose: () => void;
}

/** Read-only React rendering: no transactions, editor extensions or save callbacks. */
export function DocumentVersionDiff({
  selected,
  current,
  selectedRevision,
  currentRevision,
  title,
  onClose,
}: DocumentVersionDiffProps): ReactElement {
  useUiLocale();
  const diff = useMemo(
    () => compareStoredDocuments(selected, current),
    [selected, current],
  );
  return (
    <section aria-label={uiText('ui.DocumentVersionDiff.message003')}>
      <div className={styles.previewBanner} role="status">
        <Icon name="eye" size={16} />
        <strong>
          {uiText('ui.DocumentVersionDiff.message004')}
          {selectedRevision}
          {uiText('ui.DocumentVersionDiff.message005')}
          {currentRevision})
        </strong>
        <div className={styles.diffLegend}>
          <span data-change="added">{uiText('ui.DocumentVersionDiff.message006')}</span>
          <span data-change="removed">{uiText('ui.DocumentVersionDiff.message007')}</span>
        </div>
        <Button
          variant="ghost"
          iconOnly
          icon="x"
          aria-label={uiText('ui.DocumentHistory.message005')}
          onClick={onClose}
        />
      </div>
      <div className={[paper.paper, paper.editor, styles.diffPaper].join(' ')}>
        <h2 className={styles.paperTitle}>{title}</h2>
        {!diff.hasDifferences ? (
          <p role="status">{uiText('ui.DocumentVersionDiff.message008')}</p>
        ) : null}
        {diff.nodes.map(renderNode)}
      </div>
    </section>
  );
}
