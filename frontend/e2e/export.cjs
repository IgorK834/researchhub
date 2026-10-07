/* Production Webpack UI -> Spring -> real PostgreSQL queue -> downloaded office artifacts. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
const security = require('../dist/security-headers.json');
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
  const filename =
    req.url.startsWith('/app') || req.url === '/login'
      ? 'index.html'
      : req.url.split('?')[0].replace(/^\//, '') || 'index.html';
  const file = path.resolve('dist', filename);
  if (!file.startsWith(path.resolve('dist') + path.sep)) {
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
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill('export-owner@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/app`);
    await page.goto(`${origin}/app/workspaces/${workspace}/documents/${documentId}`);
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export document' });
    await expect(
      dialog.getByText(/^Saved revision \d+ is ready to export\.$/),
    ).toBeVisible();
    await mkdir('../backend/target/export-qa', { recursive: true });
    for (const format of ['DOCX', 'PDF']) {
      await dialog
        .getByRole('radio', { name: format === 'PDF' ? /PDF report/ : /Word document/ })
        .check();
      await dialog.getByRole('button', { name: 'Generate export', exact: true }).click();
      const downloadButton = dialog.getByRole('button', {
        name: `Download ${format}`,
        exact: true,
      });
      await expect(downloadButton).toBeVisible({ timeout: 15000 });
      await page.screenshot({
        path: `../backend/target/export-qa/export-dialog-${format.toLowerCase()}.png`,
      });
      const pending = page.waitForEvent('download');
      await downloadButton.click();
      const download = await pending;
      assert(download.suggestedFilename().endsWith(`.${format.toLowerCase()}`));
      assert(!/[\\/\r\n]/.test(download.suggestedFilename()));
      const output = `../backend/target/export-qa/browser-report.${format.toLowerCase()}`;
      await download.saveAs(output);
      const bytes = await readFile(output);
      assert(bytes.length > 1000);
      assert(
        format === 'PDF'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : bytes.subarray(0, 2).toString() === 'PK',
      );
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).not.toBeVisible();
    assert.deepEqual(errors, []);
    console.log(
      'Export E2E passed: saved revision -> asynchronous DOCX/PDF jobs -> downloaded files.',
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
