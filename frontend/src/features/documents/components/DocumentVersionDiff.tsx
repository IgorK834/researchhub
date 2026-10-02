import { createElement, useMemo, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import type { ProseMirrorDocument } from '../api/documentContent';
import { compareStoredDocuments, type DocumentDiffNode } from '../api/documentDiff';
import type { EditorCitation } from '../api/researchCitation';
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
        {citation.label ?? citation.title ?? 'Citation'}
      </span>
    );
  }
  if (node.type === 'hardBreak')
    return (
      <span {...props}>
        <br />
        <span className="visually-hidden">Line break</span>
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
  const diff = useMemo(
    () => compareStoredDocuments(selected, current),
    [selected, current],
  );
  return (
    <section aria-label="Version differences">
      <div className={styles.previewBanner} role="status">
        <Icon name="eye" size={16} />
        <strong>
          Previewing v{selectedRevision}, compared with current (v{currentRevision})
        </strong>
        <div className={styles.diffLegend}>
          <span data-change="added">Added</span>
          <span data-change="removed">Removed</span>
        </div>
        <Button
          variant="ghost"
          iconOnly
          icon="x"
          aria-label="Close version preview"
          onClick={onClose}
        />
      </div>
      <div className={[paper.paper, paper.editor, styles.diffPaper].join(' ')}>
        <h2 className={styles.paperTitle}>{title}</h2>
        {!diff.hasDifferences ? (
          <p role="status">
            No differences. This version’s content matches the current stored document.
          </p>
        ) : null}
        {diff.nodes.map(renderNode)}
      </div>
    </section>
  );
}
