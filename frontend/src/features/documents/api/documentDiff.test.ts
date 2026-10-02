import type { JSONContent } from '@tiptap/core';
import type { ProseMirrorDocument } from './documentContent';
import { compareStoredDocuments, type DocumentDiffNode } from './documentDiff';

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (value: string): JSONContent => ({
  type: 'paragraph',
  content: [text(value)],
});
const doc = (...content: JSONContent[]): ProseMirrorDocument => ({
  type: 'doc',
  content,
});
function project(nodes: readonly DocumentDiffNode[], side: 'before' | 'current'): string {
  return nodes
    .filter((entry) => entry.change !== (side === 'before' ? 'added' : 'removed'))
    .map((entry) =>
      entry.node.type === 'text' ? entry.node.text : project(entry.children, side),
    )
    .join('');
}
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

it('compares words while preserving whitespace, punctuation and both frozen inputs', () => {
  const before = frozen(doc(paragraph('The cell is cold.\nNext line!')));
  const current = frozen(doc(paragraph('The cell is warm.\nNext line!')));
  const diff = compareStoredDocuments(before, current);
  expect(diff.hasDifferences).toBe(true);
  expect(
    diff.nodes[0]?.children
      .filter((entry) => entry.change !== 'unchanged')
      .map((entry) => [entry.change, entry.node.text]),
  ).toEqual([
    ['removed', 'cold.\n'],
    ['added', 'warm.\n'],
  ]);
  expect(project(diff.nodes, 'before')).toBe('The cell is cold.\nNext line!');
  expect(project(diff.nodes, 'current')).toBe('The cell is warm.\nNext line!');
});
it('anchors inserted, removed and moved paragraphs without merging neighboring blocks', () => {
  const diff = compareStoredDocuments(
    doc(paragraph('A'), paragraph('B'), paragraph('C')),
    doc(paragraph('New'), paragraph('A'), paragraph('C'), paragraph('B')),
  );
  expect(diff.nodes.map((entry) => entry.change)).toEqual([
    'added',
    'unchanged',
    'removed',
    'unchanged',
    'added',
  ]);
  expect(project(diff.nodes, 'before')).toBe('ABC');
  expect(project(diff.nodes, 'current')).toBe('NewACB');
});
it('returns explicit equality for identical, empty and equivalent text-node segmentation', () => {
  expect(
    compareStoredDocuments(doc(paragraph('Same')), doc(paragraph('Same'))).hasDifferences,
  ).toBe(false);
  expect(compareStoredDocuments({ type: 'doc' }, doc()).hasDifferences).toBe(false);
  expect(
    compareStoredDocuments(
      doc(paragraph('Same text')),
      doc({ type: 'paragraph', content: [text('Same'), text(' text')] }),
    ).hasDifferences,
  ).toBe(false);
});
it('handles nested lists, inserted items and table row/cell changes', () => {
  const list = (first: string, extra = false): JSONContent => ({
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [
          paragraph(first),
          {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [{ type: 'listItem', content: [paragraph('Nested')] }],
          },
        ],
      },
      ...(extra ? [{ type: 'listItem', content: [paragraph('Added item')] }] : []),
    ],
  });
  const table = (value: string, extra = false): JSONContent => ({
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableHeader',
            attrs: { colspan: 2, rowspan: 1 },
            content: [paragraph('Heading')],
          },
        ],
      },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(value)] }] },
      ...(extra
        ? [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [paragraph('New row')] }],
            },
          ]
        : []),
    ],
  });
  const diff = compareStoredDocuments(
    doc(list('Old'), table('19.4')),
    doc(list('New', true), table('18.2', true)),
  );
  expect(diff.nodes.map((entry) => entry.node.type)).toEqual(['bulletList', 'table']);
  expect(diff.nodes[0]?.children[1]?.change).toBe('added');
  expect(diff.nodes[1]?.children[2]?.change).toBe('added');
  expect(diff.nodes[1]?.children[0]?.children[0]?.node.attrs).toEqual({
    colspan: 2,
    rowspan: 1,
  });
  expect(project(diff.nodes, 'before')).toBe('OldNestedHeading19.4');
  expect(project(diff.nodes, 'current')).toBe('NewNestedAdded itemHeading18.2New row');
});
it('detects formatting, headings and citation metadata changes without dropping provenance', () => {
  const oldCitation = {
    type: 'researchCitation',
    attrs: {
      citation: { sourceId: 's', sourceVersionId: 'v1', spans: [], title: 'Paper' },
    },
  };
  const newCitation = {
    ...oldCitation,
    attrs: { citation: { ...oldCitation.attrs.citation, sourceVersionId: 'v2' } },
  };
  const before = frozen(
    doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      { type: 'paragraph', content: [text('Claim'), oldCitation] },
    ),
  );
  const current = frozen(
    doc(
      { type: 'heading', attrs: { level: 3 }, content: [text('Title')] },
      {
        type: 'paragraph',
        content: [{ ...text('Claim'), marks: [{ type: 'bold' }] }, newCitation],
      },
    ),
  );
  const diff = compareStoredDocuments(before, current);
  expect(diff.nodes.slice(0, 2).map((entry) => entry.change)).toEqual([
    'removed',
    'added',
  ]);
  expect(
    diff.nodes[2]?.children
      .filter((entry) => entry.node.type === 'researchCitation')
      .map((entry) => [entry.change, entry.node.attrs?.['citation']]),
  ).toEqual([
    ['removed', oldCitation.attrs.citation],
    ['added', newCitation.attrs.citation],
  ]);
});
it('treats object key order as equivalent and keeps non-Latin text intact', () => {
  const before = doc({
    type: 'heading',
    attrs: { level: 2, custom: null },
    content: [text('温度 Łódź')],
  });
  const current = doc({
    content: [text('温度 Łódź')],
    attrs: { custom: null, level: 2 },
    type: 'heading',
  });
  expect(compareStoredDocuments(before, current).hasDifferences).toBe(false);
  const diff = compareStoredDocuments(
    before,
    doc({ ...current.content![0]!, content: [text('温度 Warszawa')] }),
  );
  expect(project(diff.nodes, 'before')).toBe('温度 Łódź');
  expect(project(diff.nodes, 'current')).toBe('温度 Warszawa');
});
it('bounds work for large changed passages and preserves complete old and new text', () => {
  const old = Array.from({ length: 600 }, (_, i) => `old${i}`).join(' ');
  const next = Array.from({ length: 600 }, (_, i) => `new${i}`).join(' ');
  const diff = compareStoredDocuments(doc(paragraph(old)), doc(paragraph(next)));
  expect(diff.hasDifferences).toBe(true);
  expect(project(diff.nodes, 'before')).toBe(old);
  expect(project(diff.nodes, 'current')).toBe(next);
});
it('represents whole added and removed documents, empty blocks and unequal changed runs', () => {
  const added = compareStoredDocuments(
    doc(),
    doc(paragraph('New'), { type: 'paragraph' }),
  );
  expect(added.nodes.map((entry) => entry.change)).toEqual(['added', 'added']);
  const removed = compareStoredDocuments(doc(paragraph('Old')), doc());
  expect(removed.nodes[0]?.change).toBe('removed');
  const diff = compareStoredDocuments(
    doc(paragraph('one two three')),
    doc(paragraph('replacement')),
  );
  expect(project(diff.nodes, 'before')).toBe('one two three');
  expect(project(diff.nodes, 'current')).toBe('replacement');
});

it('reconstructs both sides across repeated words and varied paragraph insertions and deletions', () => {
  let seed = 294;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const phrases = ['a a a', 'b a b', 'same', 'word, word.', 'two\nlines', '温度 Łódź'];
  for (let run = 0; run < 100; run++) {
    const before = Array.from(
      { length: random() % 6 },
      () => phrases[random() % phrases.length]!,
    );
    const current = Array.from(
      { length: random() % 6 },
      () => phrases[random() % phrases.length]!,
    );
    const diff = compareStoredDocuments(
      doc(...before.map(paragraph)),
      doc(...current.map(paragraph)),
    );
    expect(project(diff.nodes, 'before')).toBe(before.join(''));
    expect(project(diff.nodes, 'current')).toBe(current.join(''));
  }
});
