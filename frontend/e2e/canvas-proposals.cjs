/* global window, document */
/* Real frontend + Spring + PostgreSQL + canonical collaboration sidecar. Isolated test database. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const backend = process.env.E2E_BACKEND_URL,
  route = process.env.E2E_DOCUMENT_ROUTE;
const mode = process.env.E2E_MODE;
const distRoot = mode === 'realtime' ? 'dist' : 'dist-canvas-legacy';
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
const editor = (page) => page.locator('.tiptap[contenteditable]');
const saved = (page) =>
  expect(page.locator('[data-status="saved"]')).toBeVisible({ timeout: 15000 });
async function login(page) {
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill('proposal-owner@canvas.test');
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/app');
  await page.goto(origin + route.replace('/api/', '/app/'));
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  await saved(page);
}
async function packageRoundTrip(page, peer) {
  await page.goto(origin + route.replace('/api/', '/app/'));
  await saved(page);
  await editor(page).evaluate((node) => node.editor.commands.setTextSelection(8));
  await editor(page).focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Ask AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ask AI — document context' });
  await expect(dialog.getByText('Context ready', { exact: true })).toBeVisible();
  await dialog.getByLabel('Ask about this context').fill('Explain this saved result');
  await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel question' })).toHaveCount(0, {
    timeout: 20000,
  });
  const conversation = await dialog
    .locator('[data-canvas-conversation-id]')
    .getAttribute('data-canvas-conversation-id');
  const before = await editor(page).evaluate((node) => node.editor.getJSON());
  const beforeSaved = await page.evaluate(
    async (url) => (await (await fetch(url)).json()).content,
    route,
  );
  await dialog.getByRole('button', { name: 'Insert saved package', exact: true }).click();
  const picker = dialog.getByRole('region', { name: 'Insert saved calculation package' });
  await picker
    .getByLabel('Analysis', { exact: true })
    .selectOption(process.env.E2E_PROBLEM_ANALYSIS);
  await picker
    .getByLabel('Execution', { exact: true })
    .selectOption(process.env.E2E_PROBLEM_EXECUTION);
  await picker.getByLabel('Output', { exact: true }).selectOption('solution');
  await picker.getByRole('button', { name: 'Use selected output', exact: true }).click();
  await picker
    .getByRole('button', { name: 'Preview saved package', exact: true })
    .click();
  await expect(picker.getByText('Step result: 0.5 m/s').first()).toBeVisible({
    timeout: 15000,
  });
  expect(await editor(page).evaluate((node) => node.editor.getJSON())).toEqual(before);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          { timeout: 3000, message: `Package preview fits ${width}` },
        )
        .toBe(true);
    } catch (error) {
      console.error(
        await page.evaluate(() =>
          Array.from(document.querySelectorAll('body *'))
            .filter(
              (el) =>
                el.getBoundingClientRect().right > window.innerWidth + 1 ||
                el.getBoundingClientRect().width > window.innerWidth,
            )
            .slice(-12)
            .map((el) => ({
              tag: el.tagName,
              classes: el.className,
              text: el.textContent.slice(0, 90),
              right: el.getBoundingClientRect().right,
              width: el.getBoundingClientRect().width,
            })),
        ),
      );
      await page.screenshot({
        path: `../backend/target/canvas-package-overflow-${mode}-${width}.png`,
        fullPage: true,
      });
      throw error;
    }
    await page.screenshot({
      path: `../backend/target/canvas-package-${mode}-${width}.png`,
      fullPage: true,
    });
  }
  await picker.getByRole('button', { name: 'Insert proposal', exact: true }).click();
  await expect(editor(page).getByText('Step result: 0.5 m/s').first()).toBeVisible({
    timeout: 15000,
  });
  await saved(page);
  await expect(
    editor(page).getByRole('img', { name: 'Saved computed plot' }),
  ).toBeVisible();
  await expect(editor(page).getByRole('table')).toBeVisible();
  const inserted = await editor(page).evaluate((node) => node.editor.getJSON());
  const insertedSaved = await page.evaluate(
    async (url) => (await (await fetch(url)).json()).content,
    route,
  );
  const refs = inserted.content.filter((n) => n.type === 'analysisResult');
  expect(refs).toHaveLength(6);
  expect(new Set(refs.map((n) => n.attrs.blockId)).size).toBe(6);
  for (const node of refs) {
    expect(node.attrs.reference.executionId).toBe(process.env.E2E_PROBLEM_EXECUTION);
    expect(node.attrs.reference.conversationId).toBe(conversation);
  }
  expect(refs[1].attrs.reference.stepId).toMatch(/^[a-f0-9-]{36}$/);
  if (peer)
    await expect(editor(peer).getByText('Step result: 0.5 m/s').first()).toBeVisible({
      timeout: 15000,
    });
  await page.reload();
  await saved(page);
  await expect(editor(page).getByText('Step result: 0.5 m/s').first()).toBeVisible();
  expect(
    await page.evaluate(async (url) => (await (await fetch(url)).json()).content, route),
  ).toEqual(insertedSaved);
  expect(
    await editor(page).evaluate((node) =>
      node.editor.getJSON().content.filter((n) => n.type === 'analysisResult'),
    ),
  ).toEqual(refs);
  await expect(editor(page)).toContainText('prefix');
  await expect(editor(page)).toContainText('TARGET suffix');
  // Export the same frozen native execution from both legacy and canonical Yjs documents.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export document' });
  for (const format of ['DOCX', 'PDF', 'LATEX']) {
    await exportDialog
      .getByRole('radio', {
        name: { DOCX: /Word document/, PDF: /PDF report/, LATEX: /LaTeX sources/ }[
          format
        ],
      })
      .check();
    await exportDialog
      .getByRole('button', { name: 'Generate export', exact: true })
      .click();
    const button = exportDialog.getByRole('button', {
      name: `Download ${format === 'LATEX' ? 'LaTeX' : format}`,
      exact: true,
    });
    await expect(button).toBeVisible({ timeout: 20000 });
    const pending = page.waitForEvent('download');
    await button.click();
    const download = await pending;
    await download.saveAs(
      `../backend/target/export-qa/canvas-${mode}.${format === 'LATEX' ? 'zip' : format.toLowerCase()}`,
    );
  }
  await exportDialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  expect(
    await page.evaluate(async (url) => (await (await fetch(url)).json()).content, route),
  ).toEqual(insertedSaved);
  await page.goto(
    origin +
      route.split('/documents/')[0].replace('/api/', '/app/') +
      '/ask?conversation=' +
      conversation,
  );
  await page.getByRole('button', { name: 'Undo AI insertion', exact: true }).click();
  await expect(page.getByText('AI insertion undone', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.goto(origin + route.replace('/api/', '/app/'));
  await saved(page);
  expect(
    await page.evaluate(async (url) => (await (await fetch(url)).json()).content, route),
  ).toEqual(beforeSaved);
  await expect(editor(page).getByRole('table')).toHaveCount(0);
  if (peer) {
    await expect(editor(peer).getByRole('table')).toHaveCount(0);
    await expect(editor(peer)).toContainText('COLLABORATOR');
  }
}
async function mathRoundTrip(page, peer) {
  await page.goto(origin + route.replace('/api/', '/app/'));
  await expect(editor(page)).toBeVisible({ timeout: 15000 });
  await saved(page);
  await editor(page).evaluate((node) =>
    node.editor.commands.setTextSelection(node.editor.state.doc.content.size - 1),
  );
  await page.getByRole('button', { name: 'Insert formula', exact: true }).click();
  await page.getByLabel('Formula', { exact: true }).fill('distance / time');
  await page
    .getByRole('group', { name: 'Formula editor' })
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  await saved(page);
  await expect(editor(page).getByRole('math')).toHaveCount(1);
  await page.getByRole('button', { name: 'Insert formula', exact: true }).click();
  await page.getByLabel('Formula', { exact: true }).fill('x^2 = 4');
  await page.getByLabel('Display equation', { exact: true }).check();
  await page
    .getByRole('group', { name: 'Formula editor' })
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  await saved(page);
  await expect(editor(page).getByRole('math')).toHaveCount(2);
  if (peer) await expect(editor(peer).getByRole('math')).toHaveCount(2);
  await page.reload();
  await saved(page);
  await expect(editor(page).getByRole('math')).toHaveCount(2);
  const nodes = await editor(page).evaluate((node) => node.editor.getJSON());
  expect(JSON.stringify(nodes)).toContain('inlineMath');
  expect(JSON.stringify(nodes)).toContain('blockMath');
  expect(await editor(page).locator('.katex').count()).toBe(2);
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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.violations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.violations.push(e.effectiveDirective),
      );
    });
    await login(page);
    const peer =
      mode === 'realtime'
        ? await browser.newPage({ viewport: { width: 1440, height: 1000 } })
        : null;
    if (peer) await login(peer);
    await editor(page).evaluate((node) => node.editor.commands.setTextSelection(8));
    await editor(page).focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask AI — document context' });
    await expect(dialog.getByText('Context ready', { exact: true })).toBeVisible();
    await dialog.getByLabel('Action', { exact: true }).selectOption('EDIT');
    const before = await editor(page).evaluate((node) => node.editor.getJSON());
    await dialog.getByLabel('Ask about this context').fill('Dodaj treść');
    await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
    // Section aria-label is a region; wait for the actual reviewed package.
    await expect(
      dialog.getByRole('button', { name: 'Insert proposal', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    expect(await editor(page).evaluate((node) => node.editor.getJSON())).toEqual(before);
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(dialog).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const insert = dialog.getByRole('button', { name: 'Insert proposal', exact: true });
      await insert.scrollIntoViewIfNeeded();
      await expect(insert).toBeInViewport();
      await page.screenshot({
        path: `../backend/target/canvas-proposals-${mode}-${width}.png`,
        fullPage: true,
      });
    }
    await dialog.getByRole('button', { name: 'Reject proposal', exact: true }).click();
    await expect(dialog.getByText('Proposal: rejected', { exact: true })).toBeVisible();
    expect(await editor(page).evaluate((node) => node.editor.getJSON())).toEqual(before);
    await dialog.getByLabel('Ask about this context').fill('Dodaj więcej treści');
    await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Insert proposal', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await dialog
      .getByRole('button', { name: 'Use this proposal as context', exact: true })
      .last()
      .click();
    await dialog.getByLabel('Ask about this context').fill('Rozwiń tę propozycję');
    await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(dialog.getByText('Proposal: superseded', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(
      dialog.getByRole('button', { name: 'Insert proposal', exact: true }),
    ).toBeVisible();
    expect(await editor(page).evaluate((node) => node.editor.getJSON())).toEqual(before);
    if (peer) {
      await editor(peer).evaluate((node) => {
        let position;
        node.editor.state.doc.descendants((child, pos) => {
          if (child.isTextblock && child.textContent === 'OUTSIDE')
            position = pos + 1 + child.content.size;
        });
        node.editor.commands.setTextSelection(position);
        node.editor.commands.insertContent(' COLLABORATOR');
      });
      await saved(peer);
      await expect(editor(page)).toContainText('COLLABORATOR');
    }
    await dialog.getByRole('button', { name: 'Insert proposal', exact: true }).click();
    await expect(dialog.getByText('Proposal: accepted', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(editor(page)).toContainText('Dodaj więcej treści');
    expect(
      await editor(page).evaluate(
        (node) =>
          node.editor.state.doc.content.content.filter(
            (n) => n.textContent === 'Dodaj więcej treści',
          ).length,
      ),
    ).toBe(1);
    await expect(editor(page)).toContainText('prefix');
    await expect(editor(page)).toContainText('TARGET suffix');
    if (peer) {
      await expect(editor(peer)).toContainText('Dodaj więcej treści');
      await expect(editor(peer)).toContainText('COLLABORATOR');
    }
    const acceptedContent = await editor(page).evaluate((node) => node.editor.getJSON());
    await dialog
      .getByRole('button', { name: 'Use this proposal as context', exact: true })
      .last()
      .click();
    await dialog.getByLabel('Ask about this context').fill('Rozwiń wstawiony tekst');
    await dialog.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Replace selection', exact: true }),
    ).toBeVisible({ timeout: 20000 });
    expect(await editor(page).evaluate((node) => node.editor.getJSON())).toEqual(
      acceptedContent,
    );
    await dialog.getByRole('button', { name: 'Reject proposal', exact: true }).click();
    await expect(dialog.getByText('Proposal: rejected', { exact: true })).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Undo AI insertion', exact: true }).click();
    await expect(dialog.getByText('AI insertion undone', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(editor(page)).not.toContainText('Dodaj więcej treści');
    await expect(editor(page)).toContainText('prefix TARGET suffix');
    if (peer) {
      await expect(editor(peer)).not.toContainText('Dodaj więcej treści');
      await expect(editor(peer)).toContainText('COLLABORATOR');
    }
    const conversation = await dialog
      .locator('[data-canvas-conversation-id]')
      .getAttribute('data-canvas-conversation-id');
    await dialog.getByRole('button', { name: 'Open full chat', exact: true }).click();
    await page.waitForURL('**/ask?conversation=' + conversation);
    await page.reload();
    await expect(page.getByText('Proposal: rejected', { exact: true })).toHaveCount(2);
    await expect(page.getByText('AI insertion undone', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.violations)).toEqual([]);
    await packageRoundTrip(page, peer);
    await mathRoundTrip(page, peer);
    expect(errors).toEqual([]);
    if (peer) await peer.close();
    console.log(
      JSON.stringify({
        mode,
        conversation,
        review: 'passed',
        acceptance: 'passed',
        compensation: 'passed',
        expandProposal: 'passed',
        followupAcceptedOperation: 'passed',
        remoteEdits: peer ? 'preserved' : 'legacy',
        cspViolations: 0,
      }),
    );
  } finally {
    await browser?.close();
    server.close();
    server.closeAllConnections();
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
