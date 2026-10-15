/* Production UI -> Spring -> PostgreSQL. Synthetic account; no Gemini/model or translation service calls. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer, request } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const security = require('../dist/security-headers.json');
const artifacts = path.resolve('../backend/target/analysis-evolution-browser');
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
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
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }
  const url = req.url.split('?')[0];
  const filename =
    url.startsWith('/app') ||
    ['/', '/login', '/register', '/forgot-password'].includes(url)
      ? 'index.html'
      : url.replace(/^\//, '');
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
            : filename.endsWith('.png')
              ? 'image/png'
              : filename.endsWith('.svg')
                ? 'image/svg+xml'
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
    await mkdir(artifacts, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill('parameter@test.invalid');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/\/app/);
    await page.getByLabel('Interface language', { exact: true }).selectOption('en');
    await page.goto(
      `${origin}/app/workspaces/${workspace}/analyses/${process.env.E2E_ANALYSIS_ID}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Run with new parameters' }),
    ).toBeVisible();
    await page.getByLabel('distance (cm)', { exact: false }).fill('200');
    await expect(page.getByText('distance: 100 → 200 cm')).toBeVisible();
    await page.getByRole('button', { name: 'Run approved plan', exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(process.env.E2E_ANALYSIS_ID + '$'));
    await expect(
      page.getByRole('heading', { name: 'Comparison with original' }),
    ).toBeVisible({ timeout: 20000 });
    const table = page
      .getByRole('table')
      .filter({ has: page.getByRole('columnheader', { name: 'New result' }) });
    await expect(table.getByRole('cell', { name: '0.5', exact: true })).toBeVisible();
    await expect(table.getByRole('cell', { name: '1', exact: true })).toBeVisible();
    const violations = (await new AxeBuilder({ page }).include('main').analyze())
      .violations;
    assert.deepEqual(violations, [], JSON.stringify(violations));
    await page.screenshot({
      path: path.join(artifacts, 'parameters-en.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Comparison with original' }),
    ).toBeVisible();
    await page.getByLabel('Interface language', { exact: true }).selectOption('pl');
    await expect(
      page.getByRole('heading', { name: 'Porównanie z oryginałem' }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(artifacts, 'parameters-pl.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(artifacts, 'result.json'),
      JSON.stringify(
        {
          parameterRun: true,
          comparison: true,
          reload: true,
          locales: ['en', 'pl'],
          axeViolations: 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})();
