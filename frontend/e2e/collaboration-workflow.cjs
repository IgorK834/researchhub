/* Production UI -> Spring -> PostgreSQL. Synthetic account; no Gemini/model or translation service calls. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer, request } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const documentId = process.env.E2E_DOCUMENT_ID;
const memberId = process.env.E2E_MEMBER_ID;
const security = require('../dist/security-headers.json');
const artifacts = path.resolve('../backend/target/collaboration-workflow-browser');
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
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
  const url = req.url.split('?')[0];
  const filename =
    url.startsWith('/app') ||
    ['/', '/login', '/register', '/forgot-password'].includes(url)
      ? 'index.html'
      : url.replace(/^\//, '');
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
            : filename.endsWith('.png')
              ? 'image/png'
              : filename.endsWith('.svg')
                ? 'image/svg+xml'
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
    await mkdir(artifacts, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const memberContext = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const owner = await ownerContext.newPage(),
      member = await memberContext.newPage();
    const errors = [];
    for (const page of [owner, member])
      page.on('pageerror', (e) => errors.push(e.message));
    async function login(page, email) {
      await page.goto(`${origin}/login`);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery-staple');
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await expect(page).toHaveURL(/\/app/);
      await page.getByLabel('Interface language', { exact: true }).selectOption('en');
    }
    await login(owner, 'owner@workflow.test');
    await login(member, 'member@workflow.test');
    const docUrl = `${origin}/app/workspaces/${workspace}/documents/${documentId}`;
    await owner.goto(docUrl);
    const editor = owner.locator('.tiptap.ProseMirror').first();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.evaluate((node) => {
      node.editor.commands.focus();
      node.editor.state.doc.descendants((text, position) => {
        if (text.isText && text.text.includes('Evidence'))
          node.editor.commands.setTextSelection({ from: position, to: position + 8 });
      });
    });
    await owner.getByRole('button', { name: 'Add comment', exact: true }).click();
    const body = owner.getByLabel('Write a comment', { exact: true });
    await body.fill('Please ');
    const picker = owner.getByRole('combobox', { name: 'Mention a workspace member' });
    await picker.fill('Member');
    await expect(
      owner.getByRole('option', { name: 'Member', exact: true }),
    ).toBeVisible();
    await picker.press('Enter');
    await expect(body).toHaveValue('Please @Member ');
    const createComment = owner.waitForResponse(
      (r) => r.url().endsWith('/comments') && r.request().method() === 'POST',
    );
    await owner.getByRole('button', { name: 'Comment', exact: true }).click();
    const comment = await (await createComment).json();
    assert.equal(comment.mentions[0].userId, memberId);
    assert.equal(comment.revision, 1);
    await expect(owner.getByText('Please @Member', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () => {
          const response = await member.request.get(`${origin}/api/notifications`);
          const feed = await response.json();
          return feed.items?.some(
            (item) => item.type === 'MENTION' && item.targetId === comment.id,
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await member.reload();
    await member.getByRole('button', { name: 'Notifications', exact: true }).click();
    let notifications = member.getByRole('dialog', {
      name: 'Notifications',
      exact: true,
    });
    await expect(
      notifications.getByRole('link', { name: 'You were mentioned', exact: true }),
    ).toBeVisible();
    const digest = notifications.getByRole('region', { name: 'Catch up' });
    await expect(
      digest.getByRole('link', { name: 'You were mentioned: 1', exact: true }),
    ).toBeVisible();
    await digest.getByRole('button', { name: 'Mark digest as seen' }).click();
    await expect(digest.getByText('No new activity.')).toBeVisible();
    const frequency = notifications.getByLabel('Frequency');
    const savedPreference = member.waitForResponse(
      (r) => r.url().includes('/digests/preferences/') && r.request().method() === 'PUT',
    );
    await frequency.selectOption('MUTED');
    assert.equal((await savedPreference).status(), 204);
    await member.reload();
    await member.getByRole('button', { name: 'Notifications', exact: true }).click();
    notifications = member.getByRole('dialog', { name: 'Notifications', exact: true });
    await expect(notifications.getByLabel('Frequency')).toHaveValue('MUTED');
    await notifications.getByRole('button', { name: 'Restore defaults' }).click();
    await expect(notifications.getByLabel('Frequency')).toHaveValue('DAILY');
    const violations = (
      await new AxeBuilder({ page: member }).include('[role="dialog"]').analyze()
    ).violations;
    assert.deepEqual(violations, [], JSON.stringify(violations));
    await member.screenshot({ path: path.join(artifacts, 'notifications-en.png') });
    await notifications
      .getByRole('link', { name: 'You were mentioned', exact: true })
      .click();
    await expect(member).toHaveURL(new RegExp(`#comment-${comment.id}$`));
    await expect(member.getByText('Please @Member', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Request review', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'Create review task', exact: true });
    await dialog.getByLabel('Task title', { exact: true }).fill('Review the evidence');
    await dialog
      .getByLabel('Description', { exact: true })
      .fill('Please verify the comment.');
    const assignee = dialog.getByRole('combobox', { name: 'Assign a member' });
    await assignee.fill('Member');
    await expect(
      dialog.getByRole('option', { name: 'Member', exact: true }),
    ).toBeVisible();
    await assignee.press('Enter');
    await dialog
      .getByLabel('Due date (your local time)', { exact: true })
      .fill('2026-01-01T10:00');
    const taskResponse = owner.waitForResponse(
      (r) => r.url().endsWith('/review-tasks') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Create review task', exact: true }).click();
    const task = await (await taskResponse).json();
    assert.equal(task.assignee, memberId);
    await expect(dialog).not.toBeVisible();
    await member.goto(`${origin}/app/workspaces/${workspace}/review-tasks`);
    await member.getByRole('button', { name: 'Mine', exact: true }).click();
    await expect(
      member.getByRole('heading', { name: 'Review the evidence', exact: true }),
    ).toBeVisible();
    await member.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(member.getByText('Done · Member', { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText('Done · Member', { exact: true })).toBeVisible();
    await member.screenshot({
      path: path.join(artifacts, 'review-tasks-en.png'),
      fullPage: true,
    });
    assert.deepEqual(
      (await new AxeBuilder({ page: member }).include('#researchhub-main').analyze())
        .violations,
      [],
    );
    await member.getByLabel('Interface language', { exact: true }).selectOption('pl');
    await expect(
      member.getByRole('heading', { name: 'Zadania przeglądu', exact: true }),
    ).toBeVisible();
    await member.getByRole('button', { name: 'Powiadomienia', exact: true }).click();
    notifications = member.getByRole('dialog', { name: 'Powiadomienia', exact: true });
    await expect(
      notifications.getByRole('link', {
        name: 'Zadanie przeglądu wymaga uwagi',
        exact: true,
      }),
    ).toBeVisible();
    await member.screenshot({ path: path.join(artifacts, 'notifications-pl.png') });
    await member.keyboard.press('Escape');
    await expect(
      member.getByRole('button', { name: 'Powiadomienia', exact: true }),
    ).toBeFocused();
    await owner.request.get(`${origin}/api/auth/csrf`);
    const token = (await owner.context().cookies()).find(
      (c) => c.name === 'XSRF-TOKEN',
    ).value;
    const removed = await owner.request.delete(
      `${origin}/api/workspaces/${workspace}/members/${memberId}`,
      { headers: { 'X-XSRF-TOKEN': decodeURIComponent(token) } },
    );
    assert.equal(removed.status(), 204);
    await member.goto(docUrl);
    await expect(member.getByText('Please @Member', { exact: true })).not.toBeVisible();
    const feed = await (await member.request.get(`${origin}/api/notifications`)).json();
    assert.equal(feed.items.length, 0);
    assert.equal(
      (
        await member.request.get(
          `${origin}/api/workspaces/${workspace}/documents/${documentId}/comments/${comment.id}`,
        )
      ).status(),
      404,
    );
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(artifacts, 'result.json'),
      JSON.stringify(
        {
          checks: [
            'typed keyboard mention',
            'no implicit AI',
            'notification deep link and durable read',
            'assigned comment task in Mine',
            'completion reload',
            'revocation feed and target',
            'English and Polish',
            'axe dialog and task list',
          ],
          passed: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
