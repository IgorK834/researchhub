/* Read-only UI inventory. Data, API keys, node types, CSS classes and authored content are not UI copy. */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../../frontend/node_modules/@babel/parser');
const root = path.resolve(__dirname, '../../frontend/src');
const labels = new Set(['aria-label', 'aria-description', 'title', 'subtitle', 'footer', 'placeholder', 'label', 'description', 'caption', 'busyLabel', 'emptyText', 'loadingLabel', 'helperText', 'context', 'alt', 'header', 'hint', 'message', 'emptyMessage', 'searchPlaceholder', 'closeLabel', 'emptyLabel', 'actionLabel', 'pendingLabel', 'lead', 'secondaryLabel', 'contextTitle', 'retryLabel', 'stopLabel', 'legend', 'action', 'triggerLabel', 'blockedReason']);
const found = [];
function walkFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (!['i18n', 'testing'].includes(entry.name)) walkFiles(file); }
    else if (/\.tsx?$/.test(file) && !/\.test\.|\.typecheck\.|\.d\.ts$/.test(file)) {
      const source = fs.readFileSync(file, 'utf8');
      const ast = parser.parse(source, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
      visit(ast, null, [], file);
    }
  }
}
function add(node, file, kind, text) {
  text = text.replace(/\s+/g, ' ').trim();
  if (/[A-Za-z]{2}/.test(text) && !['ResearchHub', 'English', 'Polski', 'Gemini', 'Google', 'DOI', 'PDF', 'DOCX', 'LaTeX', 'CSL-JSON', 'BibTeX', 'RIS', 'Zotero', 'Mendeley', 'ORCID', 'Unicode', 'UTF-8', 'APA 7', 'IEEE', 'SHA-256'].includes(text)) found.push({ file: path.relative(root, file), line: node.loc.start.line, start: node.start, end: node.end, kind, text });
}
function visit(node, parent, ancestors, file) {
  if (!node || typeof node !== 'object') return;
  // Canonical default model commands and central code-based error mapping are not rendered literal UI labels.
  if (file.endsWith('/apiError.ts') || ancestors.some(n => n.type === 'FunctionDeclaration' && n.id?.name === 'authoringCommand')) return;
  if (node.type === 'JSXText') add(node, file, 'text', node.value);
  if (node.type === 'StringLiteral') {
    if (['th','td'].includes(node.value)) return;
    if (parent?.type === 'JSXAttribute' && labels.has(parent.name.name)) add(node, file, 'attribute', node.value);
    const attribute = ancestors.findLast(n => n.type === 'JSXAttribute');
    const inJsx = ancestors.some(n => n.type === 'JSXExpressionContainer') && (!attribute || labels.has(attribute.name.name));
    if (inJsx && ['JSXExpressionContainer', 'ConditionalExpression', 'LogicalExpression'].includes(parent?.type)) add(node, file, 'expression', node.value);
    if (parent?.type === 'ObjectProperty' && node === parent.value && labels.has(parent.key.name ?? parent.key.value) && (parent.key.name ?? parent.key.value) !== 'action') add(node, file, 'property', node.value);
    if (parent?.type === 'ObjectProperty' && node === parent.value && ancestors.some(n => n.type === 'VariableDeclarator' && /(?:LABELS|COPY|MESSAGES|REASONS|guidance|labels|categories|reasons|stageLabels|gettingStarted)$/.test(n.id.name))) add(node, file, 'property', node.value);
    if (parent?.type === 'ObjectProperty' && node === parent.value && ancestors.some(n => n.type === 'JSXExpressionContainer') && /(?:evidence|thread)$/.test(node.value)) add(node,file,'property',node.value);
    if (parent?.type === 'ObjectProperty' && node === parent.value && (parent.key.name ?? parent.key.value) === 'children' && ancestors.some(n => n.type === 'VariableDeclarator' && n.id.name === 'submitProps')) add(node,file,'property',node.value);
    if (file.endsWith('/landingContent.ts') && parent?.type === 'ObjectProperty' && node === parent.value && ['text','frame','name','tagline','period','cta','note','question','answer'].includes(parent.key.name)) add(node, file, 'property', node.value);
    if (file.endsWith('/landingContent.ts') && parent?.type === 'ArrayExpression' && ancestors.some(n => n.type === 'ObjectProperty' && ['points','items','features'].includes(n.key.name))) add(node, file, 'array', node.value);
    if (parent?.type === 'AssignmentPattern' && labels.has(parent.left.name)) add(node, file, 'default', node.value);
    if (parent?.type === 'CallExpression' && /^(onNotice|setValidation|setNotice|setMessage|setValidationError|setFormError|setError|setStatus|setErrorMessage|setRevocationReason|setCopied|setBlockedReason|setUploadError)$/.test(parent.callee.name) && /[A-Za-z]{2}/.test(node.value)) add(node, file, 'notice', node.value);
    if (parent?.type === 'ReturnStatement' && ancestors.some(n => /label|reason|origin/i.test(n.id?.name ?? '')) && /^[A-Z][a-z]+(?:[ -][A-Za-z]+)*$/.test(node.value)) add(node, file, 'helper', node.value);
    // Human-readable fallbacks and messages in render helpers; never machine enums or URLs.
    if (!inJsx && ['ConditionalExpression', 'LogicalExpression', 'ReturnStatement'].includes(parent?.type) && /[A-Za-z]{2}\s+[A-Za-z]{2}/.test(node.value) && !/[\/{}]|^[A-Z_]+$/.test(node.value)) add(node, file, 'helper', node.value);
  }
  if (node.type === 'TemplateLiteral' && ancestors.some(n => n.type === 'JSXExpressionContainer')) {
    const attribute = ancestors.findLast(n => n.type === 'JSXAttribute');
    if (node.quasis.some(q => /[A-Za-z]{2}/.test(q.value.cooked)) && (!attribute || labels.has(attribute.name.name)) && ['JSXExpressionContainer', 'ConditionalExpression', 'LogicalExpression'].includes(parent?.type)) add(node, file, 'template', node.quasis.map((q, i) => q.value.cooked + (i < node.expressions.length ? `{value${i}}` : '')).join(''));
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'comments', 'tokens', 'leadingComments', 'trailingComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => visit(child, node, [...ancestors, node], file));
    else if (value && typeof value === 'object') visit(value, node, [...ancestors, node], file);
  }
}
if (require.main === module) walkFiles(root);
module.exports = { collect: () => { walkFiles(root); return found; }, collectSource: (source, file) => {
  const offset = found.length;
  const ast = parser.parse(source, { sourceType: 'module', plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
  visit(ast, null, [], file); return found.slice(offset);
}, visit, root, labels };
if (require.main === module && process.argv.includes('--summary')) {
  const files = {};for (const row of found) files[row.file] = (files[row.file] || 0) + 1;
  process.stdout.write(JSON.stringify({ occurrences: found.length, unique: new Set(found.map(row => row.text)).size, files }, null, 2));
} else if (require.main === module) process.stdout.write(JSON.stringify(found, null, 2));
