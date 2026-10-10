/* Real frontend + Spring + PostgreSQL + canonical collaboration sidecar. Isolated test database. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const backend = process.env.E2E_BACKEND_URL,
  route = process.env.E2E_DOCUMENT_ROUTE;
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
    const file = path.resolve('dist', name);
    if (!file.startsWith(path.resolve('dist') + path.sep)) throw new Error('path');
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
const editor = (page) => page.locator('.tiptap[contenteditable]');
const saved = (page) =>
  expect(page.locator('[data-status="saved"]')).toBeVisible({ timeout: 15000 });
async function login(page, who) {
  await page.goto(origin + '/login');
  await page.getByLabel('Email').fill(`${who}@canvas.test`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app');
  await page.goto(origin + route.replace('/api/', '/app/'));
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
}
async function post(page, url) {
  return page.evaluate(async (url) => {
    await fetch('/api/auth/csrf');
    const csrf = globalThis.document.cookie
      .split('; ')
      .find((c) => c.startsWith('XSRF-TOKEN='))
      ?.split('=')[1];
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': decodeURIComponent(csrf),
      },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  }, url);
}
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
    const a = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
      b = await browser.newPage(),
      v = await browser.newPage();
    const errors = [];
    a.on('pageerror', (error) => errors.push(error.message));
    b.on('pageerror', (error) => errors.push(error.message));
    v.on('pageerror', (error) => errors.push(error.message));
    await login(a, 'owner');
    expect(
      await a.evaluate(() =>
        globalThis
          .getComputedStyle(globalThis.document.documentElement)
          .getPropertyValue('--color-surface')
          .trim(),
      ),
    ).not.toBe('');
    await saved(a);
    await login(b, 'owner');
    await saved(b);
    await editor(a).evaluate((node) =>
      node.editor.commands.setTextSelection({ from: 4, to: 8 }),
    );
    await editor(a).focus();
    await a.keyboard.press('Shift+F10');
    const menu = a.getByRole('menu', { name: 'Canvas actions' });
    await expect(menu).toBeVisible();
    await a.keyboard.press('End');
    await expect(a.getByRole('menuitem', { name: 'Ask AI' })).toBeFocused();
    await a.keyboard.press('Enter');
    await expect(a.getByText('Context ready', { exact: true })).toBeVisible();
    const id = await a
      .locator('[data-canvas-context-id]')
      .getAttribute('data-canvas-context-id');
    await expect(a.locator('[data-canvas-context-id] blockquote')).toHaveText('A😀B');
    await a.screenshot({
      path: path.resolve('../backend/target/canvas-context.png'),
      fullPage: true,
    });
    await a.getByRole('button', { name: 'Close', exact: true }).click();
    // A remote insertion before the range moves relative positions without changing the selected text.
    await editor(b).evaluate((node) =>
      node.editor.commands.insertContentAt(1, 'remote '),
    );
    await saved(b);
    await saved(a);
    const resolved = await post(a, `${route}/ai/contexts/${id}/resolve`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.text).toBe('A😀B');
    expect(resolved.body.target.start.offset).toBe(10);
    // Local Yjs undo affects the menu command, while preserving a collaborator's later change.
    await editor(a).evaluate((node) =>
      node.editor.commands.setTextSelection({ from: 11, to: 15 }),
    );
    await editor(a).focus();
    await a.keyboard.press('Shift+F10');
    await a.getByRole('menuitem', { name: 'Bold', exact: true }).click();
    await expect(editor(b).locator('strong')).toHaveText('A😀B');
    await editor(b).evaluate((node) =>
      node.editor.commands.insertContentAt(
        node.editor.state.doc.content.size - 1,
        ' collaborator keeps this',
      ),
    );
    await expect(editor(a)).toContainText('collaborator keeps this');
    await editor(a).focus();
    await a.keyboard.press('Shift+F10');
    await a.getByRole('menuitem', { name: 'Undo', exact: true }).click();
    await expect(editor(a).locator('strong')).toHaveCount(0);
    await expect(editor(a)).toContainText('collaborator keeps this');
    await editor(a).focus();
    await a.keyboard.press('Shift+F10');
    await a.getByRole('menuitem', { name: 'Redo', exact: true }).click();
    await expect(editor(a).locator('strong')).toHaveText('A😀B');
    await saved(a);
    await saved(b);
    // Edit the selected fragment, then ensure the old context cannot be used on a different selection.
    await editor(b).evaluate((node) =>
      node.editor.commands.insertContentAt({ from: 11, to: 15 }, 'changed'),
    );
    await saved(b);
    await saved(a);
    expect((await post(a, `${route}/ai/contexts/${id}/resolve`)).status).toBe(409);
    // Native right-click preserves an existing text range; Escape restores editor focus.
    await editor(a).evaluate((node) =>
      node.editor.commands.setTextSelection({ from: 1, to: 4 }),
    );
    const point = await editor(a).evaluate((node) => node.editor.view.coordsAtPos(2));
    await a.mouse.click(point.left + 1, (point.top + point.bottom) / 2, {
      button: 'right',
    });
    await expect(menu).toBeVisible();
    expect(
      await editor(a).evaluate((node) => [
        node.editor.state.selection.from,
        node.editor.state.selection.to,
      ]),
    ).toEqual([1, 4]);
    await a.keyboard.press('Escape');
    await expect(editor(a)).toBeFocused();
    await login(v, 'viewer');
    await editor(v).focus();
    await v.keyboard.press('Shift+F10');
    await expect(v.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
    await expect(v.getByRole('menuitem', { name: 'Cut', exact: true })).toHaveCount(0);
    await expect(v.getByRole('menuitem', { name: 'Undo', exact: true })).toHaveCount(0);
    await v.getByRole('menuitem', { name: 'Ask AI', exact: true }).click();
    await expect(v.getByText('Context ready', { exact: true })).toBeVisible();
    const viewerContext = await v
      .locator('[data-canvas-context-id]')
      .getAttribute('data-canvas-context-id');
    expect((await post(v, `${route}/ai/contexts/${viewerContext}/resolve`)).status).toBe(
      200,
    );
    await v.getByRole('button', { name: 'Close', exact: true }).click();
    for (const width of [360, 768, 1440]) {
      await a.setViewportSize({ width, height: 700 });
      await editor(a).focus();
      await a.keyboard.press('Shift+F10');
      await expect(menu).toBeVisible();
      expect(
        await menu.evaluate((node) => globalThis.getComputedStyle(node).position),
      ).toBe('fixed');
      await expect
        .poll(async () => {
          const rect = await menu.boundingBox();
          return (
            rect &&
            rect.x >= 0 &&
            rect.x + rect.width <= width &&
            rect.y >= 0 &&
            rect.y + rect.height <= 700
          );
        })
        .toBe(true)
        .catch(async (error) => {
          await a.screenshot({
            path: path.resolve('../backend/target/canvas-layout-error.png'),
            fullPage: true,
          });
          throw error;
        });
      await a.screenshot({
        path: path.resolve(`../backend/target/canvas-menu-${width}.png`),
        fullPage: true,
      });
      await a.keyboard.press('Escape');
    }
    await a.screenshot({
      path: path.resolve('../backend/target/canvas-e2e.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    console.log(
      'CANVAS E2E PASS: menu, keyboard, viewer, durable context, remote reanchor, stale target, responsive bounds',
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
