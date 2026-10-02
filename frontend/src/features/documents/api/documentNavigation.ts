import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { citationReferences } from './researchCitation';

export interface DocumentHeading {
  readonly position: number;
  readonly level: number;
  readonly title: string;
}
export interface DocumentNavigation {
  readonly headings: readonly DocumentHeading[];
  readonly references: ReturnType<typeof citationReferences>;
  readonly activePosition: number | null;
}

/** Positions and citation numbers are presentation state; never add them to saved JSON. */
export function documentNavigation(
  doc: ProseMirrorNode,
  selectionFrom: number,
): DocumentNavigation {
  const headings: DocumentHeading[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === 'heading')
      headings.push({
        position,
        level: node.attrs['level'] as number,
        title: node.textContent.trim() || 'Untitled section',
      });
  });
  return {
    headings,
    references: citationReferences(doc),
    activePosition:
      headings.filter((heading) => heading.position <= selectionFrom).at(-1)?.position ??
      null,
  };
}
