/* Real Chrome -> production Webpack app -> Spring/Testcontainers. No product database is used. */
/* global window, document */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const security = require('../dist/security-headers.json');
const workspace = process.env.E2E_WORKSPACE_ID;
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
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.effectiveDirective),
      );
    });
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill('parser-owner@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/app`);
    await page.goto(`${origin}/app/workspaces/${workspace}/devtools/ai`);
    await expect(page.getByRole('heading', { name: 'Inside the answer' })).toBeVisible();
    await expect(page.getByText('What is in Lecture 2?', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Retrieved chunks' })).toContainText(
      'Lecture 2',
    );
    await expect(page.getByRole('region', { name: 'Aggregate AI usage' })).toContainText(
      'Ask Workspace',
    );
    await expect(page.getByRole('region', { name: 'Aggregate AI usage' })).toContainText(
      'Section generation',
    );
    await expect(page.getByText(/Final structured citations/)).toBeVisible();
    await page.screenshot({
      path: '../backend/target/ai-debugger-desktop.png',
      fullPage: true,
    });
    await page.getByText(/Final structured citations/).click();
    await expect(page.locator('pre')).toContainText('sourceVersionId');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByLabel('Usage window').selectOption('7');
    await expect
      .poll(
        () =>
          responses.filter(
            (r) => r.path.includes('devtools/ai?days=7') && r.status === 200,
          ).length,
      )
      .toBeGreaterThan(0);
    for (const width of [1200, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `No page overflow at ${width}px`,
      );
    }
    await page.screenshot({
      path: '../backend/target/ai-debugger-narrow.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    // An anonymous isolated context must not receive protected diagnostics.
    const anonymous = await browser.newContext();
    const response = await anonymous.request.get(
      `${origin}/api/workspaces/${workspace}/devtools/ai`,
    );
    assert.equal(response.status(), 401);
    await anonymous.close();
    console.log(
      JSON.stringify({
        debugger: 'real Spring/worker data',
        viewport: '1600 / 1200 / 760 / 390',
        errors,
        csp: 'passed',
      }),
    );
  } finally {
    server.closeAllConnections();
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
