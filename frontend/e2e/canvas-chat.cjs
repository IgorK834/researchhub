/* Real Chrome -> production Webpack app -> Spring/Testcontainers. No product database is used. */
/* global window, document */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const distRoot = process.env.E2E_FRONTEND_DIST ?? 'dist-canvas-legacy';
const security = require(`../${distRoot}/security-headers.json`);
const workspace = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
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
  const file = path.resolve(distRoot, filename);
  if (!file.startsWith(path.resolve(distRoot) + path.sep)) {
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
        : process.platform === 'darwin'
          ? { channel: 'chrome' }
          : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    await page.waitForURL('**/app');
    const docUrl = `${origin}/app/workspaces/${workspace}/documents/${documentId}`;
    await page.goto(docUrl);
    const editor = page.locator('.tiptap[contenteditable]');
    await expect(editor).toBeVisible();
    await editor.evaluate((node) =>
      node.editor.commands.setTextSelection({ from: 1, to: 10 }),
    );
    await editor.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask AI — document context' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Ask about this context')).toBeFocused();
    await expect(page.getByText('Context ready', { exact: true })).toBeVisible();
    expect(responses.filter((r) => r.path.endsWith('/contextual'))).toHaveLength(0);
    await expect(
      page.getByRole('button', { name: 'Add comment', exact: true }),
    ).toHaveCount(0);
    expect(
      await editor.evaluate((node) => [
        node.editor.state.selection.from,
        node.editor.state.selection.to,
      ]),
    ).toEqual([1, 10]);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(
          async () => {
            const bounds = await dialog.boundingBox();
            return bounds.x >= 0 && bounds.x + bounds.width <= width + 1;
          },
          { message: `Chat fits ${width}` },
        )
        .toBe(true);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `No overflow at ${width}`,
      );
      if (width === 360)
        await expect(
          dialog.getByRole('button', { name: 'Send question' }),
        ).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: `../backend/target/canvas-chat-${width}.png`,
        fullPage: true,
      });
    }
    await dialog.getByRole('button', { name: 'Change evidence scope' }).click();
    await dialog.getByLabel('lecture.pdf', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Change evidence scope' }).click();
    await page.getByLabel('Ask about this context').fill('Explain Lecture 2');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(dialog.locator('[data-canvas-conversation-id]')).toHaveAttribute(
      'data-canvas-conversation-id',
      /.+/,
    );
    const id = await dialog
      .locator('[data-canvas-conversation-id]')
      .getAttribute('data-canvas-conversation-id');
    // Closing is independent of the saved operation. Observe it from the existing workspace history.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.goto(`${origin}/app/workspaces/${workspace}/ask?conversation=${id}`);
    await expect(page.getByRole('article', { name: 'Canvas answer' })).toHaveCount(1, {
      timeout: 15000,
    });
    await expect(page.getByRole('article', { name: 'Canvas answer' })).toContainText(
      'Lecture 2',
    );
    await expect(
      page.getByText('Document: Canvas report', { exact: false }),
    ).toBeVisible();
    expect(responses.filter((r) => r.path.endsWith('/contextual'))).toHaveLength(1);
    const generations = async () =>
      page.evaluate(
        async (path) =>
          (await (await fetch(path)).json()).messages
            .filter((m) => m.role === 'ASSISTANT')
            .map((m) => m.response.generation?.result.requestId),
        `/api/workspaces/${workspace}/ai/conversations/${id}`,
      );
    const firstGeneration = (await generations())[0];
    assert(firstGeneration);
    await page.getByLabel('Ask about this context').fill('Give more detail');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByRole('article', { name: 'Canvas answer' })).toHaveCount(2, {
      timeout: 15000,
    });
    await page.reload();
    await expect(page.getByRole('article', { name: 'Canvas answer' })).toHaveCount(2);
    expect(responses.filter((r) => r.path.endsWith('/contextual'))).toHaveLength(1);
    const ids = await generations();
    expect(ids[0]).toBe(firstGeneration);
    expect(new Set(ids).size).toBe(2);
    await page.screenshot({
      path: '../backend/target/canvas-chat-history.png',
      fullPage: true,
    });
    const history = await page.evaluate(
      async (path) => await (await fetch(path)).json(),
      `/api/workspaces/${workspace}/ai/conversations/${id}`,
    );
    expect(history.turns[1].memory.includedMessages).toBe(2);
    // A saved authoring proposal can be explicitly selected for a bounded follow-up.
    await page.goto(docUrl);
    await page.getByRole('tab', { name: 'Writing', exact: true }).click();
    await page
      .getByRole('region', { name: 'AI-assisted authoring' })
      .getByLabel('lecture.pdf', { exact: true })
      .check();
    await page
      .getByLabel('Title or instruction', { exact: true })
      .fill('Explain Lecture 2');
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await page.getByRole('button', { name: 'Explain this proposal in chat' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Follow-up target: Saved AI proposal/)).toBeVisible();
    await expect(dialog.getByText('Context ready', { exact: true })).toBeVisible();
    await dialog
      .getByLabel('Ask about this context')
      .fill('Explain Lecture 2 in this proposal');
    await dialog.getByRole('button', { name: 'Send question' }).click();
    await expect(dialog.getByRole('article', { name: 'Canvas answer' })).toHaveCount(1, {
      timeout: 15000,
    });
    const proposalConversation = await dialog
      .locator('[data-canvas-conversation-id]')
      .getAttribute('data-canvas-conversation-id');
    const proposalHistory = await page.evaluate(
      async (path) => await (await fetch(path)).json(),
      `/api/workspaces/${workspace}/ai/conversations/${proposalConversation}`,
    );
    assert(proposalHistory.turns[0].proposalId);
    expect(proposalHistory.turns[0].scope.sourceVersionIds).toHaveLength(1);
    await page.screenshot({
      path: '../backend/target/canvas-chat-proposal.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    console.log(
      JSON.stringify({
        conversationId: id,
        messages: history.messages.length,
        uniqueGenerations: ids.length,
        layouts: [360, 768, 1440],
        cspViolations: 0,
      }),
    );
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
