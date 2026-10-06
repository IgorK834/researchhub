/** Existing formatting/autosave assertions compare prose structure independently of new operation identities.
 * Dedicated provenance tests separately assert that identities survive persistence, edits and collaboration. */
export function contentWithoutBlockOrigins<T>(value: T): T {
  if (value === undefined) return value;
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const visit = (node: any): void => {
    if (
      ['paragraph', 'heading', 'codeBlock', 'figure'].includes(node?.type) &&
      node.attrs
    ) {
      delete node.attrs.blockId;
      delete node.attrs.originIntent;
      delete node.attrs.importOperationId;
      if (!Object.keys(node.attrs).length) delete node.attrs;
    }
    node?.content?.forEach(visit);
  };
  visit(copy);
  return copy;
}
