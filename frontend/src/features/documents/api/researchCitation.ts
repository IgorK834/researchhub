import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { citationPath, type Citation } from '../../ai/api/generationApi';

/** Metadata is stored, presentation numbers are derived. Legacy v0 citations remain readable. */
export interface EditorCitation extends Omit<Citation, 'chunkId'> {
  readonly schemaVersion?: '1.0';
  readonly citationId?: string;
  readonly chunkId?: string | null;
  readonly locator?: {
    readonly pageStart: number | null;
    readonly pageEnd: number | null;
    readonly sectionTitle: string | null;
  };
  readonly label?: string;
  readonly displayStyle?: 'NUMERIC' | 'SOURCE';
}

export function citationIdentity(c: EditorCitation): string {
  return (
    c.citationId ??
    JSON.stringify([
      c.workspaceId,
      c.sourceId,
      c.sourceVersionId,
      c.processingVersion,
      c.chunkId ?? null,
      c.pageStart,
      c.pageEnd,
      c.sectionTitle,
    ])
  );
}

/** Stable entities in first-occurrence order, suitable for a future bibliography export. */
export function citationReferences(doc: ProseMirrorNode): readonly {
  readonly number: number;
  readonly citation: EditorCitation;
  readonly citationId: string;
}[] {
  const references: { number: number; citation: EditorCitation; citationId: string }[] =
    [];
  const seen = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== 'researchCitation') return;
    const citation = node.attrs['citation'] as EditorCitation;
    const id = citationIdentity(citation);
    if (!seen.has(id)) {
      seen.add(id);
      references.push({ number: references.length + 1, citation, citationId: id });
    }
  });
  return references;
}
const numbering = new PluginKey<ReadonlyMap<string, number>>('researchCitationNumbering');
const numbersOf = (doc: ProseMirrorNode): ReadonlyMap<string, number> =>
  new Map(citationReferences(doc).map((ref) => [ref.citationId, ref.number]));

function validateCitation(value: unknown): void {
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid research citation');
  const c = value as Partial<EditorCitation>;
  const page = (p: unknown): boolean =>
    p === null || (typeof p === 'number' && Number.isInteger(p) && p >= 1);
  if (
    typeof c.workspaceId !== 'string' ||
    !c.workspaceId ||
    typeof c.sourceId !== 'string' ||
    !c.sourceId ||
    (c.sourceVersionId !== null && typeof c.sourceVersionId !== 'string') ||
    (c.chunkId !== undefined &&
      c.chunkId !== null &&
      !/^[a-f0-9]{64}$/.test(c.chunkId)) ||
    typeof c.processingVersion !== 'string' ||
    !c.processingVersion ||
    !Array.isArray(c.spans) ||
    c.spans.some((span) => typeof span.unitId !== 'string') ||
    !page(c.pageStart) ||
    !page(c.pageEnd) ||
    (c.pageStart !== null &&
      c.pageEnd !== null &&
      (c.pageEnd ?? 0) < (c.pageStart ?? 0)) ||
    (c.title !== undefined && c.title !== null && typeof c.title !== 'string') ||
    (c.sectionTitle !== null && typeof c.sectionTitle !== 'string') ||
    (c.schemaVersion !== undefined && c.schemaVersion !== '1.0') ||
    (c.citationId !== undefined &&
      (!c.citationId || typeof c.citationId !== 'string' || c.citationId.length > 200)) ||
    (c.label !== undefined &&
      (typeof c.label !== 'string' || !c.label.trim() || c.label.length > 200)) ||
    (c.displayStyle !== undefined && !['NUMERIC', 'SOURCE'].includes(c.displayStyle)) ||
    (c.locator !== undefined &&
      (c.locator === null ||
        c.locator.pageStart !== c.pageStart ||
        c.locator.pageEnd !== c.pageEnd ||
        c.locator.sectionTitle !== c.sectionTitle))
  )
    throw new Error('Invalid research citation');
}
function presentation(
  c: EditorCitation,
  number: number | undefined,
): { href: string; title: string; text: string } {
  const location =
    c.pageStart === null
      ? (c.sectionTitle ?? c.spans[0]?.unitId ?? 'source')
      : `p. ${c.pageStart}`;
  const label = c.label ?? c.title ?? 'Source';
  return {
    href: citationPath({ ...c, chunkId: c.chunkId ?? '' }),
    title: `${label} — ${location}`,
    text:
      c.displayStyle === 'NUMERIC' ? ` [${number ?? '?'}]` : ` [${label}, ${location}]`,
  };
}

export const ResearchCitation = Node.create({
  name: 'researchCitation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { citation: { default: null, rendered: false, validate: validateCitation } };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: numbering,
        state: {
          init: (_, state) => numbersOf(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged ? numbersOf(transaction.doc) : previous,
        },
      }),
    ];
  },
  renderHTML({ node }) {
    const c = node.attrs['citation'] as EditorCitation;
    const display = presentation(
      c,
      this.editor === undefined
        ? undefined
        : numbering.getState(this.editor.state)?.get(citationIdentity(c)),
    );
    return [
      'a',
      {
        href: display.href,
        title: display.title,
        'data-research-citation': citationIdentity(c),
      },
      display.text,
    ];
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement('a');
      const render = (): void => {
        const c = current.attrs['citation'] as EditorCitation;
        const display = presentation(
          c,
          (numbering.getState(editor.state) ?? numbersOf(editor.state.doc)).get(
            citationIdentity(c),
          ),
        );
        dom.href = display.href;
        dom.title = display.title;
        dom.textContent = display.text;
        dom.dataset['researchCitation'] = citationIdentity(c);
        dom.setAttribute('contenteditable', 'false');
      };
      render();
      editor.on('transaction', render);
      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          render();
          return true;
        },
        stopEvent: (event) => event.type === 'click',
        destroy: () => {
          editor.off('transaction', render);
        },
      };
    };
  },
});
