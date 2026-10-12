/* global window, document */
/* Real frontend + Spring + PostgreSQL + canonical collaboration sidecar. Isolated test database. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const backend = process.env.E2E_BACKEND_URL;
const distRoot = 'dist-canvas-legacy';
const security = require(`../${distRoot}/security-headers.json`);
const origin = `http://localhost:${process.env.E2E_FRONTEND_PORT}`;
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const forwarded = request(
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
    forwarded.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    forwarded.end(Buffer.concat(chunks));
    return;
  }
  try {
    const name =
      req.url.startsWith('/app') || req.url === '/login'
        ? 'index.html'
        : req.url.split('?')[0].replace(/^\//, '') || 'index.html';
    const file = path.resolve(distRoot, name);
    if (!file.startsWith(path.resolve(distRoot) + path.sep)) throw new Error('path');
    for (const [name, value] of Object.entries(security.headers))
      res.setHeader(name, value);
    res.setHeader(
      'Content-Type',
      name.endsWith('.js')
        ? 'application/javascript'
        : name.endsWith('.css')
          ? 'text/css'
          : name.endsWith('.woff2')
            ? 'font/woff2'
            : name.endsWith('.svg')
              ? 'image/svg+xml'
              : name.endsWith('.html')
                ? 'text/html'
                : 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
// Same-origin WebSocket proxy exercises the production CSP without widening it for tests.
server.on('upgrade', (req, socket, head) => {
  const upstream = request(new URL(req.url, process.env.E2E_COLLABORATION_URL), {
    headers: req.headers,
  });
  upstream.on('upgrade', (response, peer, initial) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n')}\r\n\r\n`,
    );
    if (head.length) peer.write(head);
    if (initial.length) socket.write(initial);
    peer.on('error', () => socket.destroy());
    socket.on('error', () => peer.destroy());
    socket.pipe(peer).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});

(async () => {
  let browser;
  try {
    await new Promise((resolve) =>
      server.listen(Number(process.env.E2E_FRONTEND_PORT), '127.0.0.1', resolve),
    );
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : process.env.CI
          ? {}
          : { channel: 'chrome' }),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.violations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.violations.push(e.effectiveDirective),
      );
    });
    await page.goto(origin + '/login');
    await page.getByLabel('Email', { exact: true }).fill('problem-owner@test.invalid');
    await page
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app');
    const workspace = process.env.E2E_WORKSPACE_ID;
    await page.goto(`${origin}/app/workspaces/${workspace}/analyses/new`);
    await page.getByRole('button', { name: 'Solve a problem without dataset' }).click();
    await page
      .getByLabel('Problem statement')
      .fill('Calculate average speed from distance and elapsed time.');
    await page.getByLabel('Problem formula').fill('distance / time');
    await page.getByLabel('Result unit').fill('m/s');
    await page.getByLabel('Problem parameters').fill('distance;100;cm\ntime;2;s');
    await page.getByLabel('Use the REAL domain').check();
    await page.getByLabel('Problem assumptions').fill('Constant average speed.');
    await page.getByLabel('Generate plot').check();
    await page.getByLabel('Plot range').fill('distance;0;100;11');
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/analyses'),
    );
    await page.getByRole('button', { name: 'Save problem', exact: true }).click();
    const a = await (await created).json();
    expect(a.workload).toBe('PROBLEM');
    await page.waitForURL(`**/analyses/${a.id}`);
    await page.getByRole('button', { name: 'Calculate in sandbox' }).click();
    await expect(page.getByText('Execution SUCCEEDED', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText('result: 0.5 m/s', { exact: true })).toBeVisible();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(11);
    await expect(page.getByRole('img', { name: 'Computed plot' })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Computed plot' })
          .evaluate((el) => el.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByText('result: 0.5 m/s', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reproduce frozen run' }).click();
    await expect(page.getByText('Execution SUCCEEDED', { exact: true })).toHaveCount(2, {
      timeout: 60000,
    });
    await page.getByRole('button', { name: 'Change inputs' }).click();
    await expect(page.getByLabel('Problem parameters')).toHaveValue(
      'distance;100;cm\ntime;2;s',
    );
    await page.getByLabel('Problem parameters').fill('distance;200;cm\ntime;2;s');
    const changed = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/analyses'),
    );
    await page.getByRole('button', { name: 'Save problem', exact: true }).click();
    const next = await (await changed).json();
    expect(next.parentAnalysisId).toBe(a.id);
    expect(next.snapshot.inputHash).not.toBe(a.snapshot.inputHash);
    await page.waitForURL(`**/analyses/${next.id}`);
    await page.getByRole('button', { name: 'Calculate in sandbox' }).click();
    await expect(page.getByText('result: 1 m/s', { exact: true })).toBeVisible({
      timeout: 60000,
    });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.violations)).toEqual([]);
    console.log(
      'Scientific problem E2E passed: no upload, two-phase Docker verification, plot, reload, frozen reproduction and changed-input lineage.',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(process.exitCode ?? 0);
})();
