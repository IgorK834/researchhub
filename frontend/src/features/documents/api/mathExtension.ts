import { Node } from '@tiptap/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { validateMathValue, type MathValue } from './mathAst';
export function renderMath(
  element: HTMLElement,
  value: MathValue,
  display: boolean,
): void {
  const accessible =
    typeof value?.accessibleText === 'string'
      ? value.accessibleText.slice(0, 4000)
      : 'Formula unavailable';
  element.removeAttribute('data-math-fallback');
  element.setAttribute('role', 'math');
  element.setAttribute('aria-label', accessible);
  try {
    validateMathValue(value);
    katex.render(value.notation, element, {
      displayMode: display,
      trust: false,
      strict: 'error',
      throwOnError: true,
      maxExpand: 100,
      maxSize: 10,
      macros: {},
      output: 'htmlAndMathml',
    });
    element.querySelector('.katex')?.setAttribute('aria-hidden', 'true');
  } catch {
    element.textContent = accessible;
    element.setAttribute('data-math-fallback', 'true');
  }
}
function extension(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    marks: '',
    addAttributes: () => ({ math: { default: null, renderHTML: () => ({}) } }),
    parseHTML: () => [
      {
        tag: `${inline ? 'span' : 'div'}[data-math]`,
        getAttrs: (el) => {
          try {
            const math = JSON.parse((el as HTMLElement).getAttribute('data-math') ?? '');
            validateMathValue(math);
            return { math };
          } catch {
            return false;
          }
        },
      },
    ],
    renderHTML: ({ node }) => [
      inline ? 'span' : 'div',
      { 'data-math': JSON.stringify(node.attrs['math']) },
      (node.attrs['math'] as MathValue).accessibleText,
    ],
    renderText: ({ node }) => (node.attrs['math'] as MathValue).accessibleText,
    addNodeView:
      () =>
      ({ node }) => {
        const dom = document.createElement(inline ? 'span' : 'div');
        dom.contentEditable = 'false';
        renderMath(dom, node.attrs['math'] as MathValue, !inline);
        return { dom };
      },
  });
}
export const InlineMath = extension('inlineMath', true);
export const BlockMath = extension('blockMath', false);
