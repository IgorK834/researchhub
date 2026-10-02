import { Node } from '@tiptap/core';

/** Presentation-only figure container. Content and citations remain ordinary stored nodes.
 * No image upload, analysis execution or invented provenance is introduced by this extension.
 */
export const DocumentFigure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'block+ figureCaption?',
  defining: true,
  parseHTML: () => [{ tag: 'figure' }],
  renderHTML: () => ['figure', 0],
});

export const FigureCaption = Node.create({
  name: 'figureCaption',
  content: 'inline*',
  parseHTML: () => [{ tag: 'figcaption' }],
  renderHTML: () => ['figcaption', 0],
});
