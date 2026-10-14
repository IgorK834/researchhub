/* Local deterministic checks; no translation service, model, filesystem paths from content or network access. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Ajv = require('../../frontend/node_modules/ajv/dist/2020').default;
const root = path.resolve(__dirname, '../..');
const en = require('../../frontend/src/shared/i18n/en.generated.json');
const pl = require('../../frontend/src/shared/i18n/pl.generated.json');
assert.deepEqual(Object.keys(pl).sort(), Object.keys(en).sort(), 'PL/EN catalog keys must match');
const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
for (const [key, value] of Object.entries(en)) {
  assert.ok(pl[key]?.trim(), `Missing Polish copy: ${key}`);
  assert.deepEqual(slots(value),slots(pl[key]),`Interpolation slots: ${key}`);
}
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, 'contracts/document-templates/template.schema.json'), 'utf8')));
let count = 0;
for (const locale of ['en','pl']) for (const id of ['lab-report','literature-review','thesis-chapter','statistical-report']) {
  const template = JSON.parse(fs.readFileSync(path.join(root, `backend/src/main/resources/templates/documents/${id}.${locale}.json`),'utf8'));
  assert.ok(validate(template),JSON.stringify(validate.errors));
  assert.equal(template.id,id);assert.equal(template.locale,locale);
  assert.equal(new Set(template.requiredPlaceholders.map(p => p.id)).size,template.requiredPlaceholders.length);
  for (const prompt of template.requiredPlaceholders) assert.ok(JSON.stringify(template.content).includes(`[TODO:${prompt.id}]`));
  assert.ok(!JSON.stringify(template.content).match(/researchCitation|analysisResult|https?:\/\/|file:\/\//));
  count++;
}
process.stdout.write(`Validated ${Object.keys(en).length} PL/EN UI messages and ${count} bundled template resources.\n`);
