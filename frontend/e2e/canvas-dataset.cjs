/* Real Chrome -> production Webpack app -> Spring/Testcontainers. No product database is used. */
/* global window, document */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const backend = process.env.E2E_BACKEND_URL;
const distRoot = process.env.E2E_FRONTEND_DIST ?? 'dist-canvas-legacy';
const security = require(`../${distRoot}/security-headers.json`);
const workspace = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
const responses = [],
  errors = [];
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
        responses.push({
          path: req.url,
          method: req.method,
          status: response.statusCode,
        });
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
  const filename =
    req.url.startsWith('/app') || req.url === '/login'
      ? 'index.html'
      : req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  const file = path.resolve(distRoot, filename);
  if (!file.startsWith(path.resolve(distRoot) + path.sep)) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    for (const [name, value] of Object.entries(security.headers))
      res.setHeader(name, value);
    res.setHeader(
      'Content-Type',
      filename.endsWith('.js')
        ? 'application/javascript'
        : filename.endsWith('.html')
          ? 'text/html'
          : filename.endsWith('.css')
            ? 'text/css'
            : filename.endsWith('.woff2')
              ? 'font/woff2'
              : 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : process.platform === 'darwin'
          ? { channel: 'chrome' }
          : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.effectiveDirective),
      );
    });
    await page.goto(origin + '/login');
    await page.getByLabel('Email', { exact: true }).fill('parser-owner@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app');
    const docUrl = `${origin}/app/workspaces/${workspace}/documents/${documentId}`;
    await page.goto(docUrl);
    const editor = page.locator('.tiptap[contenteditable]');
    await expect(editor).toBeVisible();
    await editor.evaluate((node) =>
      node.editor.commands.setTextSelection({ from: 1, to: 10 }),
    );
    await editor.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask AI — document context' });
    await expect(dialog.getByText('Context ready', { exact: true })).toBeVisible();
    await dialog.getByLabel('Action', { exact: true }).selectOption('ANALYZE');
    await dialog
      .getByLabel('Ask about this context')
      .fill('Calculate impedance vs frequency');
    await expect(
      dialog.getByRole('button', { name: 'Send question', exact: true }),
    ).toBeDisabled();
    await dialog
      .getByLabel('Calculation dataset version')
      .selectOption(process.env.E2E_DATASET_VERSION);
    await dialog.getByLabel('Dataset sheet measurements.csv').selectOption('CSV');
    await dialog
      .getByRole('button', { name: 'Select all inspected columns', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(dialog.locator('[data-canvas-conversation-id]')).toHaveAttribute(
      'data-canvas-conversation-id',
      /.+/,
    );
    const cid = await dialog
      .locator('[data-canvas-conversation-id]')
      .getAttribute('data-canvas-conversation-id');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(`${origin}/app/workspaces/${workspace}/ask?conversation=${cid}`);
    await expect(page.getByRole('table')).toBeVisible({ timeout: 30000 });
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 15000 });
    const history = await page.evaluate(
      async (url) => (await fetch(url)).json(),
      `/api/workspaces/${workspace}/ai/conversations/${cid}`,
    );
    const turn = history.turns[0];
    expect(turn.status).toBe('COMPLETED');
    expect(turn.resultKind).toBe('ANALYSIS_RESULT');
    expect(turn.scope.sourceVersionIds).toEqual([process.env.E2E_DATASET_VERSION]);
    const saved = await page.evaluate(
      async (url) => (await fetch(url)).json(),
      `/api/workspaces/${workspace}/analyses/${turn.analysisId}/executions/${turn.executionId}/record`,
    );
    expect(saved.execution.result.outputs[0].rows).toHaveLength(2);
    expect(saved.execution.result.outputs[0].rows[0][3]).toBeCloseTo(4.81 / 0.12, 9);
    await page.goto(docUrl);
    await expect(editor).toBeVisible();
    await editor.evaluate((node) => node.editor.commands.setTextSelection(1));
    await editor.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();
    await expect(dialog.getByText('Context ready', { exact: true })).toBeVisible();
    const original = await editor.evaluate((node) => node.editor.getJSON());
    await dialog
      .getByRole('button', { name: 'Insert saved package', exact: true })
      .click();
    const picker = dialog.getByRole('region', {
      name: 'Insert saved calculation package',
    });
    await picker.getByLabel('Analysis', { exact: true }).selectOption(turn.analysisId);
    await picker.getByLabel('Execution', { exact: true }).selectOption(turn.executionId);
    await picker
      .getByLabel('Output', { exact: true })
      .selectOption(saved.execution.result.outputs[0].name);
    await picker
      .getByRole('button', { name: 'Use selected output', exact: true })
      .click();
    await picker
      .getByRole('button', { name: 'Preview saved package', exact: true })
      .click();
    await expect(
      picker.getByRole('button', { name: 'Insert proposal', exact: true }),
    ).toBeVisible();
    expect(await editor.evaluate((node) => node.editor.getJSON())).toEqual(original);
    await picker.getByRole('button', { name: 'Insert proposal', exact: true }).click();
    await expect(editor.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-status="saved"]')).toBeVisible();
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      try {
        await expect
          .poll(
            () =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
            { timeout: 3000 },
          )
          .toBe(true);
      } catch (error) {
        console.error(
          await page.evaluate(() =>
            Array.from(document.querySelectorAll('body *'))
              .filter(
                (el) =>
                  el.getBoundingClientRect().right > window.innerWidth + 1 ||
                  el.getBoundingClientRect().width > window.innerWidth,
              )
              .slice(-12)
              .map((el) => ({
                tag: el.tagName,
                classes: el.className,
                text: el.textContent.slice(0, 70),
                right: el.getBoundingClientRect().right,
                width: el.getBoundingClientRect().width,
              })),
          ),
        );
        await page.screenshot({
          path: `../backend/target/canvas-dataset-overflow-${width}.png`,
          fullPage: true,
        });
        throw error;
      }
      if (width === 360) {
        const metrics = await editor.getByRole('table').evaluate((table) => ({
          rowHeight: table.querySelector('tbody tr').getBoundingClientRect().height,
          scroll: table.parentElement.scrollWidth > table.parentElement.clientWidth,
        }));
        expect(metrics.rowHeight).toBeLessThan(100);
        expect(metrics.scroll).toBe(true);
      }
      await page.screenshot({
        path: `../backend/target/canvas-dataset-package-${width}.png`,
        fullPage: true,
      });
    }
    const inserted = await editor.evaluate((node) => node.editor.getJSON());
    expect(inserted.content.filter((n) => n.type === 'analysisResult')).toHaveLength(2);
    await page.reload();
    await expect(editor.getByRole('table')).toBeVisible();
    expect(await editor.evaluate((node) => node.editor.getJSON())).toEqual(inserted);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    console.log(
      JSON.stringify({
        datasetVersion: process.env.E2E_DATASET_VERSION,
        execution: turn.executionId,
        reload: 'passed',
        package: 'passed',
        widths: [360, 768, 1440],
      }),
    );
  } finally {
    await browser?.close();
    server.close();
    server.closeAllConnections();
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
