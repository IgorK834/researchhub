/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import katex from 'katex';
import {
  mathNotation,
  mathPlain,
  mathValue,
  parseMath,
  validateMathValue,
  validateMathNodes,
  type MathAst,
} from './mathAst';
import { renderMath } from './mathExtension';
import {
  documentExtensions,
  readStoredDocument,
  savedDocumentOf,
} from './documentContent';
const fixtures = JSON.parse(
  readFileSync('../contracts/document/math/v1/ast-fixtures.json', 'utf8'),
) as { valid: MathAst[]; invalid: unknown[] };
test.each(fixtures.valid)('closed AST round trip %j', (ast) => {
  expect(mathNotation(ast)).toBeTruthy();
  expect(mathPlain(ast)).toBeTruthy();
  expect(() => validateMathValue(mathValue(ast))).not.toThrow();
});
test.each(fixtures.invalid)('reject hostile or oversized AST %j', (ast) =>
  expect(() => mathNotation(ast)).toThrow(),
);
test.each([
  '2 + 3 * 4',
  'distance / time',
  'x^2 = 4',
  'sqrt(4)',
  'sin(0) + cos(0)',
  '-2.50 - (1 / 2)',
  'x^-2',
])('authoring grammar %s', (text) =>
  expect(mathValue(parseMath(text)).accessibleText).toBeTruthy(),
);
test.each([
  '',
  '@evil',
  '\\href{evil}{x}',
  '2**4',
  '2^0.5',
  '(2',
  'sqrt(2',
  '2 +',
  '2 =',
  '2 ? 4',
  '9'.repeat(1001),
])('grammar refuses %s', (text) => expect(() => parseMath(text)).toThrow());
test('semantic nodes survive read, table, citations, clipboard HTML and safe renderer fallback', () => {
  const math = mathValue(parseMath('distance/time'));
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Speed: ' },
          { type: 'inlineMath', attrs: { math } },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'blockMath',
                    attrs: { math, blockId: '00000000-0000-4000-8000-000000000001' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const saved = readStoredDocument(document);
  expect(saved).not.toBeNull();
  const first = new Editor({ extensions: documentExtensions, content: saved! });
  const html = first.getHTML();
  expect(html).toContain('data-math');
  expect(first.getText()).toContain('(distance / time)');
  const second = new Editor({ extensions: documentExtensions, content: html });
  expect(savedDocumentOf(second).content?.[0]?.content?.[1]?.attrs?.math).toEqual(math);
  first.destroy();
  second.destroy();
  const el = window.document.createElement('div');
  renderMath(el, math, true);
  expect(el.getAttribute('aria-label')).toBe('(distance / time)');
  expect(el.querySelector('math')).not.toBeNull();
  const mock = jest.spyOn(katex, 'render').mockImplementation(() => {
    throw new Error('renderer');
  });
  renderMath(el, math, false);
  expect(el.textContent).toBe('(distance / time)');
  expect(el.dataset.mathFallback).toBe('true');
  mock.mockRestore();
  const hostile = {
    ...math,
    notation: '\\htmlClass{evil}{x}',
    accessibleText: '<img src=x onerror=alert(1)>',
  };
  renderMath(el, hostile, false);
  expect(el.querySelector('img')).toBeNull();
  expect(el.textContent).toBe(hostile.accessibleText);
});
test('malformed semantic fields refuse edit without empty replacement', () => {
  const math = mathValue(parseMath('2/3'));
  for (const value of [
    null,
    [],
    {},
    { ...math, notation: '\\def\\x{\\x}\\x' },
    { ...math, verification: 'VERIFIED' },
    { ...math, accessibleText: 'forged' },
    { ...math, extra: 'x' },
  ])
    expect(() => validateMathValue(value)).toThrow();
  for (const node of [
    { type: 'inlineMath' },
    { type: 'inlineMath', attrs: { math }, content: [] },
    { type: 'blockMath', attrs: { math, extra: 'x' } },
  ]) {
    expect(() => validateMathNodes(node)).toThrow();
    expect(readStoredDocument({ type: 'doc', content: [node] })).toBeNull();
  }
  let nested: unknown = { type: 'paragraph' };
  for (let i = 0; i < 66; i++) nested = { content: [nested] };
  expect(() => validateMathNodes(nested)).toThrow();
  expect(() => validateMathNodes(null)).not.toThrow();
  const safe = new Editor({
    extensions: documentExtensions,
    content: '<p>text</p><span data-math="invalid">bad</span>',
  });
  expect(savedDocumentOf(safe).content?.some((n) => n.type === 'inlineMath')).toBe(false);
  safe.destroy();
});
const references = JSON.parse(
  readFileSync('../contracts/document/math/v1/reference-fixtures.json', 'utf8'),
) as { valid: unknown[]; invalid: unknown[] };
test.each(references.valid)('structural checked-step reference %j', (n) =>
  expect(() => validateMathValue(n)).not.toThrow(),
);
test.each(references.invalid)('forged checked-step reference %j', (n) =>
  expect(() => validateMathValue(n)).toThrow(),
);

test('a corrupt renderer value has visible escaped fallback', () => {
  const el = document.createElement('div');
  renderMath(el, null as unknown as import('./mathAst').MathValue, false);
  expect(el.textContent).toBe('Formula unavailable');
  expect(el.getAttribute('role')).toBe('math');
});
