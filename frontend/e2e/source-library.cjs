/* RH-240/241/242: production UI -> authenticated Spring API -> migrated PostgreSQL. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const sourceId = process.env.E2E_SOURCE_ID;
const otherWorkspace = process.env.E2E_OTHER_WORKSPACE_ID;
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
    res.on('close', () => upstream.destroy());
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
  const errors = [];
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    async function login(target, email) {
      await target.goto(`${origin}/login`);
      await target.getByLabel('Email', { exact: true }).fill(email);
      await target
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery-staple');
      await target.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(target).toHaveURL(`${origin}/app`);
    }
    await login(page, 'owner@example.com');
    const base = `/api/workspaces/${workspace}/sources/${sourceId}`;
    const before = await (await page.request.get(`${origin}${base}`)).json();
    await page.goto(`${origin}/app/workspaces/${workspace}/sources/${sourceId}`);
    await page.getByRole('button', { name: 'Edit source details' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit source details' });
    await editor.getByLabel('Title', { exact: true }).fill('  Solar efficiency  ');
    await editor.getByLabel('Authors', { exact: true }).fill('Smith, J.\nAda Lovelace');
    await editor.getByLabel('Publication year').fill('2025');
    await editor.getByLabel('DOI', { exact: true }).fill('https://doi.org/10.1234/ABC');
    await editor.getByLabel('Journal/conference').fill('Energy Journal');
    await editor.getByLabel('URL', { exact: true }).fill('https://example.org/paper');
    await editor.getByLabel('Citation key').fill('Smith2025');
    await editor.getByRole('button', { name: 'Save bibliography' }).click();
    await expect(editor.getByText('Bibliography saved.')).toBeVisible();
    await editor.getByLabel('Display name').fill('Cell study');
    await editor.getByLabel('Tags', { exact: true }).fill('Review\nENERGY');
    await editor.getByLabel('Collections', { exact: true }).fill('Papers');
    await editor.getByRole('button', { name: 'Save organization' }).click();
    await expect(editor.getByText('Organization saved.')).toBeVisible();
    await editor.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Cell study', exact: true }),
    ).toBeVisible();
    const after = await (await page.request.get(`${origin}${base}`)).json();
    for (const key of [
      'id',
      'workspaceId',
      'originalFilename',
      'contentSha256',
      'activeVersionId',
      'activeVersionNumber',
      'uploadedBy',
      'createdAt',
    ])
      assert.deepEqual(after[key], before[key]);
    assert.equal(after.bibliography.title, 'Solar efficiency');
    assert.equal(after.bibliography.doi, '10.1234/abc');
    assert.deepEqual(after.tags, ['energy', 'review']);
    assert.deepEqual(after.collections, ['papers']);
    await mkdir('../backend/target/source-library-qa', { recursive: true });
    await page.screenshot({
      path: '../backend/target/source-library-qa/details-1440.png',
      fullPage: true,
    });
    await page.goto(`${origin}/app/workspaces/${workspace}/sources`);
    await expect(page.getByText('Page 1 · 32 matching sources')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 · 32 matching sources')).toBeVisible();
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByText('Page 1 · 32 matching sources')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search sources' }).fill('SOLAR');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('Page 1 · 1 matching sources')).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('UPLOADED');
    await page.getByLabel('Uploaded by', { exact: true }).selectOption(before.uploadedBy);
    await page.getByLabel('Tag', { exact: true }).selectOption('review');
    await page.getByRole('button', { name: 'papers', exact: true }).click();
    await page.getByRole('tab', { name: 'TXT 1', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Cell study', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: '../backend/target/source-library-qa/library-1440.png',
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('link', { name: 'Cell study', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByText('Page 1 · 32 matching sources')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByLabel('Status', { exact: true })).toBeVisible();
    await page.screenshot({
      path: '../backend/target/source-library-qa/library-1280.png',
      fullPage: true,
    });
    await page.goto(`${origin}/app/workspaces/${workspace}/sources/${sourceId}`);
    await expect(
      page.getByRole('dialog', { name: 'Source details', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit source details' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit source details' })).toBeVisible();
    await page.screenshot({
      path: '../backend/target/source-library-qa/editor-1280.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const denied = await page.request.get(
      `${origin}/api/workspaces/${otherWorkspace}/sources/search?query=private`,
    );
    assert.equal(denied.status(), 404);
    assert.equal((await denied.text()).includes('private.csv'), false);
    const readerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const reader = await readerContext.newPage();
    reader.on('pageerror', (error) => errors.push(error.message));
    await login(reader, 'viewer@example.com');
    await reader.goto(`${origin}/app/workspaces/${workspace}/sources/${sourceId}`);
    await expect(
      reader.getByRole('heading', { name: 'Cell study', exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('button', { name: 'Edit source details' })).toHaveCount(
      0,
    );
    await reader.request.get(`${origin}/api/auth/csrf`);
    const token = (await readerContext.cookies()).find(
      (cookie) => cookie.name === 'XSRF-TOKEN',
    ).value;
    const forbidden = await reader.request.put(`${origin}${base}/organization`, {
      headers: { 'X-XSRF-TOKEN': token },
      data: { displayName: 'Forbidden rename', tags: [], collections: [] },
    });
    assert.equal(forbidden.status(), 403);
    assert.deepEqual(errors, []);
    process.stdout.write(
      'Source library browser E2E passed: metadata, labels, filters, paging, reload, responsive layouts and authorization.\n',
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
