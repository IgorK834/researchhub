/* RH-243 / RH-306: production UI -> Spring -> real retrieval/PostgreSQL and explicit external discovery. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const emptyWorkspace = process.env.E2E_EMPTY_WORKSPACE_ID;
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
            : filename.endsWith('.svg')
              ? 'image/svg+xml'
              : filename.endsWith('.png')
                ? 'image/png'
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
    const retrievalUrls = [];
    page.on('request', (req) => {
      if (req.url().includes('/retrieval/search')) retrievalUrls.push(req.url());
    });
    async function login(target, email) {
      await target.goto(`${origin}/login`);
      await target.getByLabel('Email', { exact: true }).fill(email);
      await target
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery-staple');
      await target.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(target).toHaveURL(`${origin}/app`);
    }
    await login(page, 'parser-owner@example.com');
    const document = await (
      await page.request.post(`${origin}/api/workspaces/${workspace}/documents`, {
        headers: {
          'X-XSRF-TOKEN': decodeURIComponent(
            (await context.cookies()).find((cookie) => cookie.name === 'XSRF-TOKEN')
              .value,
          ),
        },
        data: {
          title: 'Search beside draft',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Keep this draft intact.' }],
              },
            ],
          },
        },
      })
    ).json();
    assert.ok(document.id);
    const currentDocument = `${origin}/app/workspaces/${workspace}/documents/${document.id}`;
    await page.goto(currentDocument);
    const shortcut = page.getByRole('button', {
      name: 'Search source text (Cmd or Ctrl K)',
    });
    await expect(shortcut).toBeEnabled();
    await page.keyboard.press('Control+k');
    const search = page.getByRole('dialog', { name: 'Search source text' });
    await expect(search.getByRole('combobox')).toBeFocused();
    await expect(search.getByRole('combobox')).toHaveCSS('box-shadow', 'none');
    await search.getByRole('combobox').fill('Lecture');
    await expect(search.getByRole('option')).toHaveCount(3);
    await expect(
      search.getByRole('status').filter({ hasText: '3 results in workspace sources' }),
    ).toHaveText('3 results in workspace sources');
    assert.ok(await search.locator('mark').count());
    assert.ok(!(await search.textContent()).includes('PRIVATE_SEARCH_CANARY'));
    await mkdir('../backend/target/source-search-qa', { recursive: true });
    await page.screenshot({ path: '../backend/target/source-search-qa/search-1440.png' });
    await search.getByRole('combobox').press('ArrowDown');
    await expect(search.getByRole('option').nth(1)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await search.getByRole('combobox').press('Control+Enter');
    const beside = page.getByRole('dialog');
    await expect(beside.getByText(/opened beside your current page/)).toBeVisible();
    await expect(beside.getByRole('button', { name: 'Open page' })).toBeVisible();
    await expect(page).toHaveURL(currentDocument);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page
        .getByRole('textbox', { name: 'Text', exact: true })
        .getByText('Keep this draft intact.', { exact: true }),
    ).toBeVisible();
    await shortcut.click();
    await page.getByRole('combobox', { name: 'Search source text' }).fill('Lecture');
    await expect(
      page.getByRole('dialog', { name: 'Search source text' }).getByRole('option'),
    ).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Search source text' }).press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/app/workspaces/${workspace}/sources/.*version=.*processingVersion=`),
    );
    assert.ok(
      retrievalUrls.every((url) =>
        url.includes(`/api/workspaces/${workspace}/retrieval/search?`),
      ),
    );
    await page.goto(`${origin}/app/workspaces/${emptyWorkspace}/sources`);
    await expect(
      page.getByRole('button', { name: 'Search source text (Cmd or Ctrl K)' }),
    ).toBeEnabled();
    await page.keyboard.press('Meta+k');
    await page
      .getByRole('combobox', { name: 'Search source text' })
      .fill('thermal drift');
    await expect(
      page.getByRole('heading', { name: 'Nothing matches “thermal drift”' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Search sources only', exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: 'Search source text' }),
    ).toBeFocused();
    await expect
      .poll(() =>
        page
          .locator('img[data-illustration="search"]')
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.screenshot({ path: '../backend/target/source-search-qa/empty-1440.png' });
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('combobox', { name: 'Search source text' })).toHaveValue(
      '',
    );
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/app/workspaces/${workspace}/sources`);
    await page
      .getByRole('link', { name: 'External web references', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: 'Enable external search' }),
    ).not.toBeChecked();
    await expect(page.getByLabel('Search the external web')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Enable external search' }).check();
    await page.getByLabel('Search the external web').fill('solar efficiency');
    await page.getByRole('button', { name: 'Search external web', exact: true }).click();
    await expect(
      page.getByText('1 external web results · BRAVE', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Record reference', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reference recorded' })).toBeDisabled();
    await page.getByText('Discovery provenance').click();
    await expect(page.getByText('Snapshot SHA-256', { exact: true })).toBeVisible();
    await page.screenshot({
      path: '../backend/target/source-search-qa/external-1440.png',
    });
    await page.reload();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByText('Discovery provenance')).toBeVisible();
    assert.equal(
      (
        await (
          await page.request.get(`${origin}/api/workspaces/${workspace}/sources`)
        ).json()
      ).length,
      2,
    );
    assert.equal(
      (
        await page.request.get(
          `${origin}/api/workspaces/${otherWorkspace}/external-sources`,
        )
      ).status(),
      404,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: '../backend/target/source-search-qa/external-1280.png',
    });
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search source text' }).fill('Lecture');
    await expect(
      page.getByRole('dialog', { name: 'Search source text' }).getByRole('option'),
    ).toHaveCount(3);
    await page.screenshot({ path: '../backend/target/source-search-qa/search-1280.png' });
    await page.keyboard.press('Escape');
    const readerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const reader = await readerContext.newPage();
    await login(reader, 'search-viewer@example.com');
    await reader.goto(`${origin}/app/workspaces/${workspace}/external-sources`);
    await expect(reader.getByText('Discovery provenance')).toBeVisible();
    await expect(reader.getByRole('checkbox')).toHaveCount(0);
    await reader.keyboard.press('Control+k');
    await reader.getByRole('combobox', { name: 'Search source text' }).fill('Lecture');
    await expect(
      reader.getByRole('dialog', { name: 'Search source text' }).getByRole('option'),
    ).toHaveCount(3);
    await readerContext.close();
    assert.deepEqual(errors, []);
    console.log(
      'Source search browser E2E passed: real retrieval, keyboard, immutable page links, beside preview, empty state, external consent/provenance, viewer and workspace isolation, 1440/1280 layouts.',
    );
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
