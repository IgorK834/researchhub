/* Production Webpack UI -> Spring -> isolated PostgreSQL/worker/sandbox fixtures.
   Invoked by SourceExtractionEndToEndTest; never targets a product database. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
const aiBlock = process.env.E2E_AI_BLOCK;
const dist = path.resolve(__dirname, '../dist');
const security = require('../dist/security-headers.json');
if (!backend || !workspace || !documentId || !aiBlock)
  throw new Error('Isolated fixture coordinates are required');
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/actuator/')) {
    const upstream = request(
      new URL(req.url, backend),
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: new URL(backend).host,
          ...(req.headers.origin ? { origin: 'http://localhost:3000' } : {}),
        },
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    return;
  }
  const url = new URL(req.url, 'http://test.local');
  const filename = path.extname(url.pathname) ? url.pathname.slice(1) : 'index.html';
  const file = path.resolve(dist, filename);
  if (!file.startsWith(dist + path.sep)) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    for (const [name, value] of Object.entries(security.headers))
      res.setHeader(name, value);
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[path.extname(file)] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const axe = async (selector) => {
    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
    const result = await (selector ? builder.include(selector) : builder).analyze();
    assert.deepEqual(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
    );
  };
  try {
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill('parser-owner@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/\/app/);
    await page.goto(`${origin}/app/workspaces/${workspace}/documents/${documentId}`);
    const chip = page.locator('a[data-research-citation]').first();
    await chip.focus();
    await page.keyboard.press('Enter');
    const citation = page.getByRole('dialog', { name: /Citation/ });
    await citation.getByRole('button', { name: 'Show provenance', exact: true }).click();
    let panel = page.getByRole('dialog', { name: 'Provenance', exact: true });
    await expect(panel.getByText('lecture.pdf', { exact: true })).toBeVisible();
    for (const field of [
      'Immutable source version',
      'Page or fragment',
      'Fragment content hash (SHA-256)',
      'Source content hash (SHA-256)',
    ])
      await expect(panel.getByText(field, { exact: true })).toBeVisible();
    assert.match(
      await panel
        .getByRole('link', { name: 'Open source reader at this version' })
        .getAttribute('href'),
      /version=/,
    );
    await axe('[role="dialog"]');
    await page.keyboard.press('Escape');
    await expect(chip).toBeFocused();
    // First select the AI-origin paragraph, then invoke the document's one provenance action.
    await page.locator(`[data-block-id="${aiBlock}"]`).click();
    await page
      .getByRole('group', { name: 'Selected block provenance' })
      .getByRole('button', { name: 'Show provenance', exact: true })
      .click();
    panel = page.getByRole('dialog', { name: 'Provenance', exact: true });
    await expect(panel.getByText('Approving user', { exact: true })).toBeVisible();
    for (const field of [
      'Model name',
      'Model version',
      'Template version',
      'Approved at',
    ])
      await expect(panel.getByText(field, { exact: true }).first()).toBeVisible();
    assert.ok(!(await panel.textContent()).includes('Not recorded'));
    await axe('[role="dialog"]');
    await page.keyboard.press('Escape');
    await page
      .locator('[data-analysis-block]')
      .getByRole('button', { name: 'Show provenance', exact: true })
      .click();
    panel = page.getByRole('dialog', { name: 'Provenance', exact: true });
    for (const field of [
      'Generated Python',
      'Code SHA-256',
      'Runtime version',
      'Image',
      'Duration',
      'Saved outputs',
      'Re-run origin',
    ])
      await expect(panel.getByText(field, { exact: true })).toBeVisible();
    await axe('[role="dialog"]');
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/app/workspaces/${workspace}/settings`);
    await expect(page.getByRole('table', { name: 'AI usage by feature' })).toBeVisible();
    await expect(page.getByText('Current request quotas', { exact: true })).toBeVisible();
    for (const format of ['CSV', 'JSON']) {
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
      const download = await downloaded;
      const data = await readFile(await download.path(), 'utf8');
      assert.ok(
        !data.includes('Lecture') &&
          !data.includes('Parser Owner') &&
          !data.includes('parser-owner@example.com'),
      );
      if (format === 'JSON') assert.ok(JSON.parse(data).length > 0);
      else assert.ok(data.startsWith('id,kind,actorId'));
    }
    await axe('section[aria-label="Workspace governance"]');
    await page.goto(`${origin}/app/account`);
    const downloadEvent = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Export personal data (JSON)', exact: true })
      .click();
    const personal = JSON.parse(
      await readFile(await (await downloadEvent).path(), 'utf8'),
    );
    assert.equal(personal.account.email, 'parser-owner@example.com');
    assert.ok(!JSON.stringify(personal).includes('password_hash'));
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await page
      .getByLabel('Confirm your password', { exact: true })
      .fill('correct-horse-battery-staple');
    await axe('[role="dialog"]');
    await page
      .getByRole('button', { name: 'Permanently delete account', exact: true })
      .click();
    await expect(page).toHaveURL(/\/account-deletion$/);
    await expect(page.getByText('Live-store data erased.', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await axe('main');
    assert.deepEqual(errors, []);
    console.log(
      'governance-browser: citation, AI and analysis provenance in two clicks; keyboard/focus/axe; safe CSV/JSON export; AI quotas; personal export; durable erasure verified',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
