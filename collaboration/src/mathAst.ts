/** Closed normalized AST. No LaTeX, macros, HTML or parser with code evaluation crosses this boundary. */
export type MathAst =
  | { op: 'number'; value: string }
  | { op: 'symbol'; name: string }
  | { op: 'add' | 'mul'; args: MathAst[] }
  | { op: 'div' | 'eq'; left: MathAst; right: MathAst }
  | { op: 'pow'; base: MathAst; exponent: number }
  | { op: 'sqrt' | 'sin' | 'cos'; arg: MathAst };
export interface MathValue {
  schemaVersion: '1.0';
  ast: MathAst;
  notation: string;
  accessibleText: string;
  verification: null | {
    analysisId: string;
    executionId: string;
    outputName: string;
    stepIndex: number;
    inputHash: string;
  };
}
const decimal = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const symbol = /^[A-Za-z][A-Za-z0-9]{0,15}$/;
function fields(n: Record<string, unknown>, keys: string[]) {
  if (Object.keys(n).length !== keys.length || keys.some((k) => !Object.hasOwn(n, k)))
    throw new Error('Invalid math AST');
}
export function mathNotation(value: unknown): string {
  let count = 0;
  function walk(v: unknown, depth: number): string {
    if (++count > 128 || depth > 12 || !v || typeof v !== 'object' || Array.isArray(v))
      throw new Error('Math complexity limit');
    const n = v as Record<string, unknown>;
    const next = (a: unknown) => walk(a, depth + 1);
    switch (n.op) {
      case 'number':
        fields(n, ['op', 'value']);
        if (
          typeof n.value !== 'string' ||
          n.value.length > 40 ||
          !decimal.test(n.value) ||
          n.value === '-0' ||
          /\.\d*0$/.test(n.value)
        )
          throw new Error('Use canonical decimal numbers');
        return n.value;
      case 'symbol':
        fields(n, ['op', 'name']);
        if (typeof n.name !== 'string' || !symbol.test(n.name))
          throw new Error('Invalid symbol');
        return `\\mathrm{${n.name}}`;
      case 'add':
      case 'mul':
        fields(n, ['op', 'args']);
        if (!Array.isArray(n.args) || n.args.length < 2 || n.args.length > 8)
          throw new Error('Invalid operands');
        return '(' + n.args.map(next).join(n.op === 'add' ? ' + ' : ' \\cdot ') + ')';
      case 'div':
      case 'eq':
        fields(n, ['op', 'left', 'right']);
        return n.op === 'eq'
          ? `${next(n.left)} = ${next(n.right)}`
          : `\\frac{${next(n.left)}}{${next(n.right)}}`;
      case 'pow':
        fields(n, ['op', 'base', 'exponent']);
        if (!Number.isInteger(n.exponent) || Math.abs(n.exponent as number) > 8)
          throw new Error('Invalid exponent');
        return `{${next(n.base)}}^{${n.exponent}}`;
      case 'sqrt':
      case 'sin':
      case 'cos':
        fields(n, ['op', 'arg']);
        return `\\${n.op}{${next(n.arg)}}`;
      default:
        throw new Error('Unsupported math operator');
    }
  }
  const notation = walk(value, 0);
  if (notation.length > 4000) throw new Error('Math notation length limit');
  return notation;
}
export function mathPlain(ast: MathAst): string {
  mathNotation(ast);
  function walk(n: MathAst): string {
    switch (n.op) {
      case 'number':
        return n.value;
      case 'symbol':
        return n.name;
      case 'add':
      case 'mul':
        return '(' + n.args.map(walk).join(n.op === 'add' ? ' + ' : ' * ') + ')';
      case 'div':
      case 'eq':
        return (
          '(' + walk(n.left) + (n.op === 'div' ? ' / ' : ' = ') + walk(n.right) + ')'
        );
      case 'pow':
        return '(' + walk(n.base) + ' ^ ' + n.exponent + ')';
      default:
        return n.op + '(' + walk(n.arg) + ')';
    }
  }
  return walk(ast);
}
export function mathValue(ast: MathAst): MathValue {
  const notation = mathNotation(ast);
  return {
    schemaVersion: '1.0',
    ast,
    notation,
    accessibleText: mathPlain(ast),
    verification: null,
  };
}
export function validateMathValue(value: unknown): asserts value is MathValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid math value');
  const n = value as Record<string, unknown>;
  fields(n, ['schemaVersion', 'ast', 'notation', 'accessibleText', 'verification']);
  if (n.verification !== null) {
    if (
      !n.verification ||
      typeof n.verification !== 'object' ||
      Array.isArray(n.verification)
    )
      throw new Error('Invalid verification reference');
    const r = n.verification as Record<string, unknown>;
    fields(r, ['analysisId', 'executionId', 'outputName', 'stepIndex', 'inputHash']);
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (
      typeof r.analysisId !== 'string' ||
      !uuid.test(r.analysisId) ||
      typeof r.executionId !== 'string' ||
      !uuid.test(r.executionId) ||
      typeof r.outputName !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(r.outputName) ||
      typeof r.stepIndex !== 'number' ||
      !Number.isInteger(r.stepIndex) ||
      r.stepIndex < 0 ||
      r.stepIndex > 31 ||
      typeof r.inputHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.inputHash)
    )
      throw new Error('Invalid verification reference');
  }
  if (
    n.schemaVersion !== '1.0' ||
    n.notation !== mathNotation(n.ast) ||
    n.accessibleText !== mathPlain(n.ast as MathAst)
  )
    throw new Error('Invalid normalized math');
}
export function validateMathNodes(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('Document nesting limit');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const n = value as Record<string, unknown>;
  if (n.type === 'inlineMath' || n.type === 'blockMath') {
    if (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs))
      throw new Error('Missing formula');
    const a = n.attrs as Record<string, unknown>;
    validateMathValue(a.math);
    if (
      n.content !== undefined ||
      (Array.isArray(n.marks) && n.marks.length > 0) ||
      Object.keys(a).some(
        (k) => !['math', 'blockId', 'originIntent', 'importOperationId'].includes(k),
      )
    )
      throw new Error('Invalid formula attributes');
  }
  if (Array.isArray(n.content)) n.content.forEach((v) => validateMathNodes(v, depth + 1));
}
/** Small explicit arithmetic grammar for authoring; never evaluates input. */
export function parseMath(text: string): MathAst {
  if (text.length > 1000) throw new Error('Formula is too long');
  const tokens =
    text.match(/[A-Za-z][A-Za-z0-9]*|[0-9]+(?:\.[0-9]+)?|[()+*/^=-]|\S/g) ?? [];
  let i = 0;
  function atom(): MathAst {
    const t = tokens[i++];
    if (t === '(') {
      const n = sum();
      if (tokens[i++] !== ')') throw new Error('Missing parenthesis');
      return n;
    }
    if (t === '-') return { op: 'mul', args: [{ op: 'number', value: '-1' }, atom()] };
    if (t && decimal.test(t)) {
      const value = t
        .replace(/^0+(?=\d)/, '')
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '');
      return { op: 'number', value };
    }
    if (t && symbol.test(t)) {
      if (['sqrt', 'sin', 'cos'].includes(t) && tokens[i] === '(') {
        i++;
        const arg = sum();
        if (tokens[i++] !== ')') throw new Error('Missing parenthesis');
        return { op: t as 'sqrt' | 'sin' | 'cos', arg };
      }
      return { op: 'symbol', name: t };
    }
    throw new Error('Use numbers, symbols, + - * / ^ = and sqrt/sin/cos');
  }
  function power(): MathAst {
    let n = atom();
    if (tokens[i] === '^') {
      i++;
      let sign = 1;
      if (tokens[i] === '-') {
        i++;
        sign = -1;
      }
      const e = tokens[i++];
      if (!e || !/^\d+$/.test(e)) throw new Error('Use an integer exponent');
      n = { op: 'pow', base: n, exponent: sign * Number(e) };
    }
    return n;
  }
  function product(): MathAst {
    let n = power();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const right = power();
      n = op === '*' ? { op: 'mul', args: [n, right] } : { op: 'div', left: n, right };
    }
    return n;
  }
  function sum(): MathAst {
    let n = product();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      let right = product();
      if (op === '-') right = { op: 'mul', args: [{ op: 'number', value: '-1' }, right] };
      n = { op: 'add', args: [n, right] };
    }
    return n;
  }
  let n = sum();
  if (tokens[i] === '=') {
    i++;
    n = { op: 'eq', left: n, right: sum() };
  }
  if (i !== tokens.length) throw new Error('Unexpected formula token');
  mathNotation(n);
  return n;
}
