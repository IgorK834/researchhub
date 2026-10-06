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
    // Review uses the real UI and durable Spring API, anchored to text carried by the shared CRDT.
    await a.bringToFront();
    await editor(a).evaluate((node) => {
      node.editor.commands.focus();
      node.editor.state.doc.descendants((text, position) => {
        const index = text.isText ? text.text.indexOf('RECEIPT') : -1;
        if (index >= 0)
          node.editor.commands.setTextSelection({
            from: position + index,
            to: position + index + 7,
          });
      });
    });
    await a.getByRole('button', { name: 'Add comment', exact: true }).click();
    await a
      .getByLabel('Write a comment', { exact: true })
      .fill('Please cite the receipt.');
    await a.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(a.getByText('Please cite the receipt.', { exact: true })).toBeVisible();
    await b.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(b.getByText('Please cite the receipt.', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await b.getByRole('button', { name: 'Reply', exact: true }).click();
    await b.getByLabel('Reply to Owner').fill('I will add the source.');
    await b.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(b.getByText('I will add the source.', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Find evidence with AI', exact: true }).click();
    await expect(a.getByRole('region', { name: 'AI evidence suggestion' })).toBeVisible();
    await expect(b.getByRole('region', { name: 'AI evidence suggestion' })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      a.getByRole('link', { name: 'Receipt study · p. 7', exact: true }),
    ).toHaveAttribute('href', /processingVersion=retrieval-1%3Abrowser/);
    await expect(a.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
    await append(b, ' BEFORE_CITATION');
    await saved(b);
    await a.getByRole('button', { name: 'Insert citation', exact: true }).click();
    await expect(a.getByText('Citation inserted manually', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(b.getByText('Citation inserted manually', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(editor(b).locator('[data-research-citation]')).toHaveCount(1);
    await a.screenshot({
      path: path.join(output, 'comments-browser-ai-evidence.png'),
      fullPage: true,
    });
    await a.getByRole('tab', { name: 'Provenance', exact: true }).click();
    const originPanel = a.getByRole('region', { name: 'Block provenance' });
    await expect(originPanel.getByText(/Citation added manually/)).toBeVisible({
      timeout: 12000,
    });
    await expect(originPanel.getByText(/Source operation:/)).toBeVisible();
    await expect(
      originPanel.getByRole('link', { name: 'Receipt study · p. 7' }),
    ).toHaveAttribute('href', /processingVersion=retrieval-1%3Abrowser/);
    await a.screenshot({
      path: path.join(output, 'document-browser-provenance.png'),
      fullPage: true,
    });
    await a.getByRole('button', { name: 'Comments', exact: true }).click();
    await b.bringToFront();
    const resolution = b.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/comments/'),
    );
    await b.getByRole('button', { name: 'Resolve', exact: true }).click();
    assert.equal((await resolution).status(), 200);
    await a.bringToFront();
    await expect(a.getByRole('button', { name: 'Resolved (1)' })).toBeVisible({
      timeout: 10000,
    });
    await a.getByRole('button', { name: 'Resolved (1)' }).click();
    await a.getByRole('button', { name: 'Reopen', exact: true }).click();
    await a.getByRole('button', { name: 'Open (1)' }).click();
    await a.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(a.getByText(/reopened the thread/)).toBeVisible();
    // Nearby peer typing must leave a working anchor. The navigation button locates its current text.
    await append(b, ' NEARBY_COMMENT');
    await saved(b);
    const anchorButton = a.getByRole('button', { name: 'Go to commented text: RECEIPT' });
    await anchorButton.click();
    await expect
      .poll(() =>
        editor(a).evaluate((node) => {
          const { from, to } = node.editor.state.selection;
          return node.editor.state.doc.textBetween(from, to);
        }),
      )
      .toBe('RECEIPT');
    await a.screenshot({
      path: path.join(output, 'comments-browser-thread.png'),
      fullPage: true,
    });
    // A viewer has the same readable discussion, with no creation or thread mutation controls.
    const readerContext = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
    });
    const reader = await readerContext.newPage();
    reader.on('pageerror', (error) => errors.push(error.message));
    await reader.goto(`${origin}/login`);
    await reader.getByLabel('Email', { exact: true }).fill('viewer@collab.test');
    await reader
      .getByLabel('Password', { exact: true })
      .fill('correct-horse-battery-staple');
    await reader.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(reader).toHaveURL(`${origin}/app`);
    await reader.goto(`${origin}${route.replace('/api/', '/app/')}`);
    await reader.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(
      reader.getByText('Please cite the receipt.', { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByText('I will add the source.', { exact: true }),
    ).toBeVisible();
    for (const name of [
      'Add comment',
      'Reply',
      'Resolve',
      'Reopen',
      'Find evidence with AI',
      'Insert citation',
    ])
      await expect(reader.getByRole('button', { name, exact: true })).toHaveCount(0);
    await reader.screenshot({
      path: path.join(output, 'comments-browser-viewer.png'),
      fullPage: true,
    });
    await readerContext.close();
    // Deleting the exact marked text preserves its discussion across save/reload as an orphan.
    await anchorButton.click();
    await editor(a).evaluate((node) => node.editor.commands.deleteSelection());
    await saved(a);
    for (const page of pages) {
      await page.reload();
      await saved(page);
      await page.getByRole('button', { name: 'Comments', exact: true }).click();
      await expect(
        page.getByText(
          'Original passage is no longer available. This thread is preserved.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Go to commented text: RECEIPT' }),
      ).toBeDisabled();
      await expect(
        page.getByText('I will add the source.', { exact: true }),
      ).toBeVisible();
    }
    await a.screenshot({
      path: path.join(output, 'comments-browser-orphan.png'),
      fullPage: true,
    });
    // Named snapshots freeze the shared state. Later online/offline replicas cannot overwrite a restored epoch.
    await a.getByRole('button', { name: 'History', exact: true }).click();
    await a.getByLabel('Snapshot name').fill('After evidence review');
    await a.getByRole('button', { name: 'Save named snapshot', exact: true }).click();
    await expect(a.getByText('Named snapshot saved.')).toBeVisible();
    const beforeVersions = await (
      await contexts[0].request.get(origin + route + '/versions')
    ).json();
    const milestone = beforeVersions.find(
      (version) => version.name === 'After evidence review',
    );
    assert(
      milestone && milestone.stateSha256,
      'Named snapshot captures committed collaborative state',
    );
    await append(b, ' AFTER_NAMED_SNAPSHOT');
    await saved(b);
    await saved(a);
    await contexts[1].setOffline(true);
    await append(b, ' OLD_EPOCH_OFFLINE');
    const snapshotRow = a
      .getByRole('list', { name: 'Versions' })
      .getByText('After evidence review', { exact: true })
      .locator('..')
      .locator('..');
    await snapshotRow
      .getByRole('button', {
        name: `Restore revision ${milestone.revision}`,
        exact: true,
      })
      .click();
    await snapshotRow
      .getByRole('button', {
        name: `Confirm restore of revision ${milestone.revision}`,
        exact: true,
      })
      .click();
    await saved(a);
    await excludes(a, 'AFTER_NAMED_SNAPSHOT');
    await contexts[1].setOffline(false);
    await expect(
      b.getByRole('button', { name: 'Load restored snapshot', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await b.getByRole('button', { name: 'Load restored snapshot', exact: true }).click();
    await saved(b);
    await excludes(b, 'AFTER_NAMED_SNAPSHOT');
    await excludes(b, 'OLD_EPOCH_OFFLINE');
    await excludes(a, 'OLD_EPOCH_OFFLINE');
    const afterVersions = await (
      await contexts[0].request.get(origin + route + '/versions')
    ).json();
    for (const version of beforeVersions)
      assert(
        afterVersions.some((row) => row.id === version.id),
        'Restore preserves every later snapshot',
      );
    assert(
      afterVersions.some(
        (version) =>
          version.reason === 'RESTORE' && version.restoredFromVersionId === milestone.id,
      ),
    );
    assert(afterVersions.some((version) => version.name === 'Before restore'));
    await a.getByRole('button', { name: 'History', exact: true }).click();
    await a.screenshot({
      path: path.join(output, 'document-browser-restored-history.png'),
      fullPage: true,
    });
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
          'selected-text comment, reply, resolve and reopen',
          'durable comment contribution activity',
          'explicit AI evidence contribution with source provenance',
          'manual citation insertion and atomic acceptance audit through Yjs',
          'anchor after peer edits',
          'viewer read-only comments',
          'orphaned thread after deletion and reload',
          'block provenance inspector with source operation and citations',
          'named collaborative snapshots',
          'restore preserves later history and retires offline replicas',
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
