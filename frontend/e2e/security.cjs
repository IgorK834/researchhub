/* Real Chrome -> production Webpack app -> Spring/Testcontainers. No product database is used. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
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
    res.setHeader(
      'Content-Type',
      filename.endsWith('.js')
        ? 'application/javascript'
        : filename.endsWith('.html')
          ? 'text/html'
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email', { exact: true }).fill('browser-security@example.com');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/app`);
    await page.goto(`${origin}/app/workspaces/${workspace}/sources`);
    await page.getByRole('button', { name: 'Upload source', exact: true }).click();
    await expect(
      page.getByText(/Archives and macro-enabled Office files are not supported/),
    ).toBeVisible();
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/workspaces/${workspace}/sources`) &&
        response.request().method() === 'POST',
    );
    await page.getByLabel('Source file', { exact: true }).setInputFiles({
      name: 'forged.docx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([80, 75, 3, 4, 1, 2, 3, 4]),
    });
    assert.equal((await rejected).status(), 415);
    await expect(
      page.getByText(/The file content does not match a supported, macro-free document/),
    ).toBeVisible();
    await page.screenshot({ path: '../backend/target/security-upload-browser.png' });
    await page.goto(`${origin}/app/workspaces/${workspace}/ask`);
    await expect(
      page.getByRole('button', { name: 'Ask research question' }),
    ).toBeEnabled();
    const question = 'Keep this highlighted claim while the research quota resets';
    await page.getByLabel('Research question').fill(question);
    const limited = page.waitForResponse(
      (response) =>
        response.url().includes('/messages/stream') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Ask research question' }).click();
    const response = await limited;
    assert.equal(response.status(), 429);
    const problem = await response.json();
    assert.equal(problem.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(problem.quotaCategory, 'LLM');
    assert.equal(response.headers()['retry-after'], String(problem.retryAfterSeconds));
    await expect(page.getByText(/Try again in \d+ seconds/)).toBeVisible();
    await expect(page.getByLabel('Research question')).toHaveValue(question);
    await expect(page.getByRole('button', { name: 'Retry answer' })).toHaveCount(0);
    await page.screenshot({ path: '../backend/target/security-quota-browser.png' });
    assert.equal(
      responses.filter((item) => item.path.includes('/messages/stream')).length,
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        upload: '415, no persistence',
        ai: '429, input preserved, no automatic retry',
        errors,
      }),
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
