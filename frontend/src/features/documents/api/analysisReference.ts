import { Node, type JSONContent } from '@tiptap/core';

export interface AnalysisReference {
  readonly analysisId: string;
  readonly executionId: string;
  /** Persisted output name, unique within this execution; never an image URL. */
  readonly outputId: string;
  readonly renderMode: 'CHART' | 'TABLE' | 'SUMMARY';
}
export interface AnalysisBlockAttrs {
  readonly blockId: string;
  readonly reference: AnalysisReference;
  readonly caption: string;
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function isAnalysisReference(value: unknown): value is AnalysisReference {
  return (
    fields(value, ['analysisId', 'executionId', 'outputId', 'renderMode']) &&
    typeof value.analysisId === 'string' &&
    uuid.test(value.analysisId) &&
    typeof value.executionId === 'string' &&
    uuid.test(value.executionId) &&
    typeof value.outputId === 'string' &&
    value.outputId.trim().length > 0 &&
    value.outputId.length <= 100 &&
    typeof value.renderMode === 'string' &&
    ['CHART', 'TABLE', 'SUMMARY'].includes(value.renderMode)
  );
}
export function isAnalysisBlockAttrs(value: unknown): value is AnalysisBlockAttrs {
  return (
    fields(value, ['blockId', 'reference', 'caption']) &&
    typeof value.blockId === 'string' &&
    uuid.test(value.blockId) &&
    isAnalysisReference(value.reference) &&
    typeof value.caption === 'string' &&
    value.caption.length <= 1000
  );
}
export function analysisBlock(
  reference: AnalysisReference,
  caption: string,
  blockId = crypto.randomUUID(),
): JSONContent {
  const attrs = { blockId, reference, caption };
  if (!isAnalysisBlockAttrs(attrs)) throw new Error('Invalid analysis reference');
  return { type: 'analysisResult', attrs };
}
/** Reject malformed references before ProseMirror can silently discard unknown attributes. */
export function validateAnalysisNodes(
  node: unknown,
  ids = new Set<string>(),
  depth = 0,
): void {
  if (depth > 64) throw new Error('Document nesting exceeds the limit');
  if (!object(node)) return;
  if (node.type === 'analysisResult') {
    if (
      !fields(node, ['type', 'attrs']) ||
      !isAnalysisBlockAttrs(node.attrs) ||
      ids.has(node.attrs.blockId) ||
      ids.size >= 50
    )
      throw new Error('Invalid analysis result block');
    ids.add(node.attrs.blockId);
  }
  if (Array.isArray(node.content))
    node.content.forEach((child) => validateAnalysisNodes(child, ids, depth + 1));
}
export const AnalysisResultBlock = Node.create({
  name: 'analysisResult',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      blockId: { default: null },
      reference: { default: null },
      caption: { default: '' },
    };
  },
  // Clipboard HTML never creates an authorized semantic reference. The JSON schema owns the metadata.
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'section',
    { 'data-analysis-result': node.attrs.blockId },
    node.attrs.caption || 'Referenced analysis result',
  ],
});
