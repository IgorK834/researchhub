/* Real app, two isolated Chrome sessions, Spring/Testcontainers and an independently restarted Node process.
 * Launched by CollaborationApiIntegrationTest; no product database is modified. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const route = process.env.E2E_DOCUMENT_ROUTE;
const output = path.resolve('../backend/target');
let service,
  browser,
  wsPort,
  failed = false,
  loseResponse = false;
let lostResponses = 0,
  snapshots = 0;
const patches = [],
  errors = [];
const proxy = createServer(async (req, res) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/internal/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const snapshot = req.url.endsWith('/snapshot');
    if (snapshot && failed) {
      res.writeHead(503);
      res.end('{}');
      return;
    }
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
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (snapshot && response.statusCode === 200) {
            snapshots++;
            if (loseResponse) {
              loseResponse = false;
              lostResponses++;
              res.destroy();
              return;
            }
          }
          let result = Buffer.concat(chunks);
          const headers = { ...response.headers };
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          if (
            req.url.endsWith('/collaboration/credential') &&
            response.statusCode === 200
          ) {
            const credential = JSON.parse(result.toString());
            credential.websocketUrl = `ws://127.0.0.1:${wsPort}`;
            result = Buffer.from(JSON.stringify(credential));
          }
          res.writeHead(response.statusCode, headers);
          res.end(result);
        });
      },
    );
    forwarded.on('error', (error) => {
      res.writeHead(502);
      res.end(error.message);
    });
    forwarded.end(body);
    return;
  }
  try {
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
async function startService(origin) {
  service = spawn('node', ['dist/main.js'], {
    cwd: path.resolve('../collaboration'),
    env: {
      ...process.env,
      COLLABORATION_PORT: String(wsPort),
      COLLABORATION_BACKEND_URL: origin,
      COLLABORATION_ALLOWED_ORIGINS: origin,
    },
  });
  service.stdout.on('data', (data) => process.stdout.write(data));
  service.stderr.on('data', (data) => process.stderr.write(data));
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${wsPort}/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 10000 },
    )
    .toBe(200);
}
async function stopService() {
  const child = service;
  service = null;
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}
const editor = (page) => page.locator('.tiptap[contenteditable]');
const saved = (page) =>
  expect(page.locator('[data-status="saved"]')).toBeVisible({ timeout: 15000 });
// Caret labels are DOM decorations and may sit inside a word. Inspect actual ProseMirror text.
const contains = (page, text) =>
  expect
    .poll(() => editor(page).evaluate((node) => node.editor.getText()), {
      timeout: 15000,
    })
    .toContain(text);
const excludes = (page, text) =>
  expect
    .poll(() => editor(page).evaluate((node) => node.editor.getText()))
    .not.toContain(text);
async function append(page, text) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}
async function run() {
  try {
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    const reserve = createServer();
    await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
    wsPort = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    await startService(origin);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    ]);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (req) => {
        if (req.method() === 'PATCH' && req.url().endsWith(route))
          patches.push(req.url());
      });
      await page.goto(`${origin}/login`);
      await page
        .getByLabel('Email', { exact: true })
        .fill(index === 0 ? 'owner@collab.test' : 'editor@collab.test');
      await page
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery-staple');
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page).toHaveURL(`${origin}/app`);
      await page.goto(`${origin}${route.replace('/api/', '/app/')}`);
      await expect(editor(page)).toHaveAttribute('contenteditable', 'true', {
        timeout: 15000,
      });
      await saved(page);
    }
    const [a, b] = pages;
    // Only authenticated, active document sessions appear, including ephemeral selections.
    for (const page of pages)
      await expect(
        page.getByRole('group', { name: 'In this document now' }),
      ).toBeVisible();
    assert.equal(await a.getByRole('group', { name: 'Workspace members' }).count(), 0);
    // Same initial paragraph, independent input transactions: both CRDT insertions must survive.
    await Promise.all([append(a, 'ALPHA'), append(b, 'BETA')]);
    for (const page of pages) {
      await contains(page, 'ALPHA');
      await contains(page, 'BETA');
      await saved(page);
    }
    await a.bringToFront();
    await editor(a).evaluate((node) => {
      node.editor.commands.focus();
      node.editor.commands.setTextSelection({ from: 1, to: 4 });
    });
    await expect(editor(b).locator('.collaboration-carets__label')).toHaveText('Owner');
    await expect(editor(b).locator('.collaboration-carets__selection')).toBeVisible();
    const presenceOnly = await (await contexts[0].request.get(origin + route)).json();
    assert(!JSON.stringify(presenceOnly.content).includes('cursor'));
    assert(!JSON.stringify(presenceOnly.content).includes('displayName'));
    await a.screenshot({
      path: path.join(output, 'collaboration-browser-presence.png'),
      fullPage: true,
    });
    await b.goto(`${origin}/app`);
    await expect(a.getByRole('group', { name: 'In this document now' })).toHaveCount(0, {
      timeout: 10000,
    });
    await expect(editor(a).locator('.collaboration-carets__label')).toHaveCount(0);
    await b.goto(`${origin}${route.replace('/api/', '/app/')}`);
    await saved(b);
    for (const page of pages)
      await expect(
        page.getByRole('group', { name: 'In this document now' }),
      ).toBeVisible();
    await a.getByRole('button', { name: 'Undo', exact: true }).click();
    await excludes(b, 'ALPHA');
    await contains(b, 'BETA');
    await a.getByRole('button', { name: 'Redo', exact: true }).click();
    await contains(b, 'ALPHA');
    await saved(a);
    // Browser offline and process restart both drop the socket. Peer edits are recovered by state-vector sync.
    await contexts[0].setOffline(true);
    await stopService();
    await expect(
      a.getByText('Offline — changes are kept on this device. Reconnecting…'),
    ).toBeVisible();
    await startService(origin);
    await saved(b);
    await append(b, ' MISSED');
    await saved(b);
    await contexts[0].setOffline(false);
    await contains(a, 'MISSED');
    await saved(a);
    // A failed durable write never reaches the peer; origin retains the pending Yjs state.
    failed = true;
    await append(a, ' RECOVERED');
    await expect(
      a.getByText('The save service is unavailable.', { exact: false }),
    ).toBeVisible({ timeout: 10000 });
    await excludes(b, 'RECOVERED');
    await a.screenshot({
      path: path.join(output, 'collaboration-browser-save-failed.png'),
      fullPage: true,
    });
    failed = false;
    await a.getByRole('button', { name: 'Retry saving', exact: true }).click();
    await contains(b, 'RECOVERED');
    await saved(a);
    // Lost HTTP response after DB commit retries the identical snapshot identity, without a duplicate revision.
    const before = await (await contexts[0].request.get(origin + route)).json();
    loseResponse = true;
    await append(b, ' RECEIPT');
    await saved(b);
    await contains(a, 'RECEIPT');
    const after = await (await contexts[0].request.get(origin + route)).json();
    assert.equal(lostResponses, 1);
    assert.equal(after.revision, before.revision + 1);
    await a.getByRole('button', { name: 'Save version', exact: true }).click();
    await expect
      .poll(async () => {
        const versions = await (
          await contexts[0].request.get(origin + route + '/versions')
        ).json();
        return versions.some((version) => version.revision === after.revision);
      })
      .toBe(true);
    await expect(editor(a)).toHaveAttribute('contenteditable', 'true');
    await contains(a, 'RECEIPT');
    await expect(a.getByLabel('Title', { exact: true })).toHaveValue('Report');
    await stopService();
    await startService(origin);
    await Promise.all(pages.map((page) => page.reload()));
    for (const [index, page] of pages.entries()) {
      await expect(editor(page)).toHaveAttribute('contenteditable', 'true', {
        timeout: 15000,
      });
      for (const text of ['ALPHA', 'BETA', 'MISSED', 'RECOVERED', 'RECEIPT'])
        await contains(page, text);
      await saved(page);
      await page.screenshot({
        path: path.join(output, `collaboration-browser-${index + 1}.png`),
        fullPage: true,
      });
    }
    // Membership changes happen through the same owner API as the Members screen.
    const workspaceRoute = route.split('/documents/')[0];
    const memberRoute = workspaceRoute + '/members/' + process.env.E2E_EDITOR_ID;
    async function ownerRequest(method, url, data) {
      await contexts[0].request.get(origin + '/api/auth/csrf');
      const csrf = (await contexts[0].cookies()).find(
        (cookie) => cookie.name === 'XSRF-TOKEN',
      );
      const response = await contexts[0].request.fetch(origin + url, {
        method,
        data,
        headers: { 'X-XSRF-TOKEN': decodeURIComponent(csrf.value) },
      });
      assert(
        response.ok(),
        `Owner ${method} ${url}: ${response.status()} ${await response.text()}`,
      );
    }
    await ownerRequest('PATCH', memberRoute, { role: 'VIEWER' });
    await expect(editor(b)).toHaveAttribute('contenteditable', 'false', {
      timeout: 12000,
    });
    await expect(
      b.getByRole('button', { name: 'Archive document', exact: true }),
    ).toHaveCount(0);
    await expect(
      b.getByText('Editing access has changed.', { exact: false }),
    ).toBeVisible();
    await expect(a.getByRole('group', { name: 'In this document now' })).toHaveCount(0);
    // Even a forged local editor command cannot get past Spring/closed transport.
    await editor(b).evaluate((node) =>
      node.editor.commands.insertContent(' DENIED_VIEWER'),
    );
    await excludes(a, 'DENIED_VIEWER');
    await editor(b).evaluate((node) => node.editor.commands.undo());
    await ownerRequest('PATCH', memberRoute, { role: 'EDITOR' });
    await b.reload();
    await saved(b);
    await expect(a.getByRole('group', { name: 'In this document now' })).toBeVisible();
    await ownerRequest('DELETE', memberRoute);
    await expect(editor(b)).toHaveAttribute('contenteditable', 'false', {
      timeout: 12000,
    });
    await expect(a.getByRole('group', { name: 'In this document now' })).toHaveCount(0);
    await contexts[1].request.get(origin + '/api/auth/csrf');
    const editorCsrf = (await contexts[1].cookies()).find(
      (cookie) => cookie.name === 'XSRF-TOKEN',
    );
    const reconnect = await contexts[1].request.post(
      origin + route + '/collaboration/credential',
      { data: {}, headers: { 'X-XSRF-TOKEN': decodeURIComponent(editorCsrf.value) } },
    );
    assert.equal(reconnect.status(), 404);
    await ownerRequest('POST', workspaceRoute + '/archive', {});
    await expect(editor(a)).toHaveAttribute('contenteditable', 'false', {
      timeout: 12000,
    });
    await expect(
      a.getByText('Editing access has changed.', { exact: false }),
    ).toBeVisible();
    await a.screenshot({
      path: path.join(output, 'collaboration-browser-access-revoked.png'),
      fullPage: true,
    });
    const persisted = await (await contexts[0].request.get(origin + route)).json();
    assert(!JSON.stringify(persisted.content).includes('DENIED_VIEWER'));
    assert.equal(
      patches.length,
      0,
      'Realtime editing must never send whole-document PATCH autosaves',
    );
    assert.deepEqual(errors, [], 'The actual browser app must have no uncaught errors');
    console.log(
      JSON.stringify({
        event: 'browser.e2e.passed',
        scenarios: [
          'authenticated presence/cursors/selections',
          'presence removed on disconnect',
          'editor demotion',
          'member removal/reconnect denied',
          'workspace archive',
          'concurrent text',
          'local undo/redo',
          'offline/reconnect',
          'persistence failure recovery',
          'lost response idempotency',
          'immutable checkpoint',
          'SIGKILL/restart',
          'IndexedDB reload',
          'no REST autosaves',
        ],
        snapshots,
      }),
    );
  } finally {
    if (browser) await browser.close();
    await stopService();
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
