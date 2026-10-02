import type { JSONContent } from '@tiptap/core';
import type { ProseMirrorDocument } from './documentContent';

export type DocumentChange = 'unchanged' | 'added' | 'removed';
export interface DocumentDiffNode {
  readonly node: JSONContent;
  readonly change: DocumentChange;
  readonly children: readonly DocumentDiffNode[];
}
export interface DocumentDiff {
  readonly nodes: readonly DocumentDiffNode[];
  readonly hasDifferences: boolean;
}

function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${fingerprint(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? '';
}

function marked(node: JSONContent, change: DocumentChange): DocumentDiffNode {
  return {
    node,
    change,
    children: (node.content ?? []).map((child) => marked(child, change)),
  };
}

// Keep whitespace and punctuation exactly, including non-Latin scripts. Marks travel with each word.
function words(nodes: readonly JSONContent[]): readonly JSONContent[] {
  const joined: JSONContent[] = [];
  for (const node of nodes) {
    const last = joined.at(-1);
    if (
      node.type === 'text' &&
      last?.type === 'text' &&
      fingerprint(node.marks) === fingerprint(last.marks)
    ) {
      joined[joined.length - 1] = {
        ...last,
        text: (last.text ?? '') + (node.text ?? ''),
      };
    } else joined.push(node);
  }
  return joined.flatMap((node) =>
    node.type === 'text'
      ? ((node.text ?? '').match(/\S+\s*|\s+/gu)?.map((text) => ({ ...node, text })) ??
        [])
      : [node],
  );
}

/**
 * Selected stored version is the base; added text belongs to the current stored document.
 * Exact nodes anchor a bounded LCS. Within changed runs, compatible containers are compared recursively,
 * so lists, rows and cells keep their structure. Inline text is compared by word, including marks and citation
 * attributes in its identity. Inputs are never changed and the result is never sent to a ProseMirror editor.
 * A shared cell budget bounds quadratic work; large changed runs fall back to complete remove/add runs.
 */
export function compareStoredDocuments(
  before: ProseMirrorDocument,
  current: ProseMirrorDocument,
): DocumentDiff {
  let remainingCells = 250_000;
  let hasDifferences = false;
  const compare = (
    left: readonly JSONContent[],
    right: readonly JSONContent[],
  ): DocumentDiffNode[] => {
    const oldNodes = words(left);
    const newNodes = words(right);
    const oldKeys = oldNodes.map(fingerprint);
    const newKeys = newNodes.map(fingerprint);
    const result: DocumentDiffNode[] = [];
    let prefix = 0;
    while (
      prefix < oldNodes.length &&
      prefix < newNodes.length &&
      oldKeys[prefix] === newKeys[prefix]
    ) {
      result.push(marked(newNodes[prefix]!, 'unchanged'));
      prefix++;
    }
    let oldEnd = oldNodes.length;
    let newEnd = newNodes.length;
    while (
      oldEnd > prefix &&
      newEnd > prefix &&
      oldKeys[oldEnd - 1] === newKeys[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }
    const changeRun = (
      oldStart: number,
      oldStop: number,
      newStart: number,
      newStop: number,
    ): void => {
      if (
        oldNodes.slice(oldStart, oldStop).every((node) => node.type === 'text') &&
        newNodes.slice(newStart, newStop).every((node) => node.type === 'text')
      ) {
        if (oldStart !== oldStop || newStart !== newStop) hasDifferences = true;
        result.push(
          ...oldNodes.slice(oldStart, oldStop).map((node) => marked(node, 'removed')),
        );
        result.push(
          ...newNodes.slice(newStart, newStop).map((node) => marked(node, 'added')),
        );
        return;
      }
      const count = Math.max(oldStop - oldStart, newStop - newStart);
      for (let index = 0; index < count; index++) {
        const oldNode =
          index < oldStop - oldStart ? oldNodes[oldStart + index] : undefined;
        const newNode =
          index < newStop - newStart ? newNodes[newStart + index] : undefined;
        if (
          oldNode &&
          newNode &&
          oldNode.type !== 'text' &&
          oldNode.content &&
          newNode.content &&
          fingerprint({
            type: oldNode.type,
            attrs: oldNode.attrs,
            marks: oldNode.marks,
          }) ===
            fingerprint({
              type: newNode.type,
              attrs: newNode.attrs,
              marks: newNode.marks,
            })
        ) {
          result.push({
            node: newNode,
            change: 'unchanged',
            children: compare(oldNode.content, newNode.content),
          });
        } else {
          hasDifferences = true;
          if (oldNode) result.push(marked(oldNode, 'removed'));
          if (newNode) result.push(marked(newNode, 'added'));
        }
      }
    };
    const rows = oldEnd - prefix;
    const columns = newEnd - prefix;
    const cells = (rows + 1) * (columns + 1);
    if (rows === 0 || columns === 0 || cells > remainingCells) {
      changeRun(prefix, oldEnd, prefix, newEnd);
    } else {
      remainingCells -= cells;
      const matrix = new Uint32Array(cells);
      const stride = columns + 1;
      for (let i = rows - 1; i >= 0; i--) {
        for (let j = columns - 1; j >= 0; j--) {
          matrix[i * stride + j] =
            oldKeys[prefix + i] === newKeys[prefix + j]
              ? 1 + matrix[(i + 1) * stride + j + 1]!
              : Math.max(matrix[(i + 1) * stride + j]!, matrix[i * stride + j + 1]!);
        }
      }
      let i = 0;
      let j = 0;
      let oldStart = prefix;
      let newStart = prefix;
      while (i < rows && j < columns) {
        if (oldKeys[prefix + i] === newKeys[prefix + j]) {
          changeRun(oldStart, prefix + i, newStart, prefix + j);
          result.push(marked(newNodes[prefix + j]!, 'unchanged'));
          oldStart = prefix + ++i;
          newStart = prefix + ++j;
        } else if (matrix[(i + 1) * stride + j]! >= matrix[i * stride + j + 1]!) {
          i++;
        } else {
          j++;
        }
      }
      changeRun(oldStart, oldEnd, newStart, newEnd);
    }
    for (let index = newEnd; index < newNodes.length; index++)
      result.push(marked(newNodes[index]!, 'unchanged'));
    return result;
  };
  const nodes = compare(before.content ?? [], current.content ?? []);
  return { nodes, hasDifferences };
}
