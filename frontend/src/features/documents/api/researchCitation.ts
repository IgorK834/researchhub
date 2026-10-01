import { Node } from '@tiptap/core';
import { citationPath, type Citation } from '../../ai/api/generationApi';

/** An atomic, versioned source reference. Source text is rendered as text, never HTML. */
export const ResearchCitation = Node.create({
  name: 'researchCitation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      citation: {
        default: null,
        rendered: false,
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null)
            throw new Error('Invalid research citation');
          const c = value as Partial<Citation>;
          if (
            typeof c.workspaceId !== 'string' ||
            typeof c.sourceId !== 'string' ||
            typeof c.chunkId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(c.chunkId) ||
            typeof c.processingVersion !== 'string' ||
            !Array.isArray(c.spans) ||
            c.spans.some((span) => typeof span.unitId !== 'string') ||
            (c.pageStart !== null &&
              (!Number.isInteger(c.pageStart) || (c.pageStart ?? 0) < 1)) ||
            (c.title !== undefined && c.title !== null && typeof c.title !== 'string') ||
            (c.sectionTitle !== null && typeof c.sectionTitle !== 'string')
          )
            throw new Error('Invalid research citation');
        },
      },
    };
  },
  renderHTML({ node }) {
    const citation = node.attrs['citation'] as Citation | null;
    if (citation === null) return ['span', {}, '[Missing citation]'];
    const location =
      citation.pageStart === null
        ? (citation.sectionTitle ?? citation.spans[0]?.unitId ?? 'source')
        : `p. ${citation.pageStart}`;
    return [
      'a',
      {
        href: citationPath(citation),
        'data-research-citation': citation.chunkId,
        title: `${citation.title ?? 'Source'} — ${location}`,
      },
      ` [${citation.title ?? 'Source'}, ${location}]`,
    ];
  },
});
