import { getSchema, Mark, Node, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
// Transport-only schema, pinned to editor/v1. Presentation, React and API clients stay in the browser.
// Contract tests round-trip every custom node, including opaque provenance attributes.
export const schema = getSchema([
  Extension.create({name:'blockIdentity',addGlobalAttributes:() => [{types:['paragraph','heading','codeBlock','figure'],attributes:{blockId:{default:null},originIntent:{default:null},importOperationId:{default:null}}}]}),
  StarterKit.configure({link: false, undoRedo: false}), Table.configure({resizable: false}), TableRow, TableHeader, TableCell,
  Node.create({name: 'researchCitation', group: 'inline', inline: true, atom: true, addAttributes: () => ({citation: {default: null}})}),
  Node.create({name: 'figure', group: 'block', content: 'block+ figureCaption?', defining: true}),
  Node.create({name: 'figureCaption', content: 'inline*'}),
  Node.create({name: 'analysisResult', group: 'block', atom: true, addAttributes: () => ({blockId: {default: null}, reference: {default: null}, caption: {default: ''}})}),
  Mark.create({name: 'commentAnchor', inclusive: false, keepOnSplit: false, addAttributes: () => ({ids: {default: []}})}),
]);
