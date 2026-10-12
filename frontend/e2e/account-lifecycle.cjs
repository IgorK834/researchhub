/* Production Webpack UI -> two Spring instances -> PostgreSQL -> local mail links.
   Requires E2E_BACKEND_URL (invite-only), E2E_BOOTSTRAP_URL (open), E2E_MAIL_LOG.
   Run only against an isolated test database. No existing workspace is modified. */
const { chromium, expect } = require('@playwright/test');
const { createServer, request } = require('node:http');
const { readFile, stat, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const bootstrap = process.env.E2E_BOOTSTRAP_URL;
const mailLog = process.env.E2E_MAIL_LOG;
if (!backend || !bootstrap || !mailLog)
  throw new Error('E2E backend, bootstrap and mail log are required');
const dist = path.resolve(__dirname, '../dist');
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
    req.pipe(upstream);
    return;
  }
  const relative = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(dist, relative);
  try {
    const asset = (await stat(file)).isFile() ? file : path.join(dist, 'index.html');
    const extension = path.extname(asset);
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      }[extension] || 'application/octet-stream',
    );
    res.end(await readFile(asset));
  } catch {
    res.setHeader('Content-Type', 'text/html');
    res.end(await readFile(path.join(dist, 'index.html')));
  }
});
// Existing public config requires worker model metadata; no inference runs in this test.
const metadataServer = createServer((req, res) => {
  if (req.url !== '/internal/ai/model') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      provider: 'deterministic',
      name: 'account-test-fixture',
      version: '1',
      structuredOutput: true,
      streaming: false,
    }),
  );
});
const origin = 'http://127.0.0.1:3113';
const password = 'correct-horse-battery-staple';
const ownerEmail = `owner-${Date.now()}@example.test`;
const invitedEmail = `invited-${Date.now()}@example.test`;
async function post(context, base, route, data) {
  await context.request.get(`${base}/api/auth/csrf`);
  const cookies = await context.cookies(base);
  const csrf = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN').value;
  return context.request.post(`${base}${route}`, {
    data,
    headers: { 'X-XSRF-TOKEN': decodeURIComponent(csrf) },
  });
}
async function mailToken(kind, after) {
  let token;
  await expect
    .poll(
      async () => {
        const content = (await readFile(mailLog, 'utf8')).slice(after);
        const matches = [
          ...content.matchAll(new RegExp(`/${kind}#([A-Za-z0-9_-]{43})`, 'g')),
        ];
        token = matches.at(-1)?.[1];
        return Boolean(token);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return token;
}
(async () => {
  await new Promise((resolve) => metadataServer.listen(18190, '127.0.0.1', resolve));
  await new Promise((resolve) => server.listen(3113, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const owner = await browser.newContext();
    const signedUp = await post(owner, bootstrap, '/api/auth/register', {
      email: ownerEmail,
      password,
      displayName: 'Workspace Owner',
    });
    assert.equal(signedUp.status(), 201);
    assert.equal(
      (
        await post(owner, bootstrap, '/api/auth/login', { email: ownerEmail, password })
      ).status(),
      200,
    );
    const workspace = await post(owner, bootstrap, '/api/workspaces', {
      name: 'Account lifecycle E2E',
    });
    assert.equal(workspace.status(), 201);
    const id = (await workspace.json()).id;
    // Browser and API origins share localhost cookies via the local reverse proxy.
    const ownerCookies = await owner.cookies(bootstrap);
    await owner.addCookies(
      ownerCookies.map((cookie) => ({ ...cookie, domain: '127.0.0.1', secure: false })),
    );
    const ownerPage = await owner.newPage();
    await ownerPage.goto(`${origin}/app/workspaces/${id}/members`);
    await ownerPage.getByLabel('Invite email', { exact: true }).fill(invitedEmail);
    await ownerPage.getByLabel('Invited role', { exact: true }).selectOption('EDITOR');
    await ownerPage
      .getByRole('button', { name: 'Create invitation', exact: true })
      .click();
    const linkField = ownerPage.getByLabel('Invitation link', { exact: true });
    await expect(linkField).toBeVisible();
    const link = await linkField.inputValue();
    const newcomer = await browser.newContext();
    const page = await newcomer.newPage();
    await page.goto(link);
    await page.getByRole('link', { name: 'Create account with this invitation' }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Invited Researcher');
    await page.getByLabel('Email', { exact: true }).fill(invitedEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL(/\/login#invite:/);
    await page.getByLabel('Email', { exact: true }).fill(invitedEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(
      page.getByText('Verify your email first, then return to this invitation.'),
    ).toBeVisible();
    let after = (await readFile(mailLog, 'utf8')).length;
    await page
      .getByRole('button', { name: 'Send verification link', exact: true })
      .click();
    const verification = await mailToken('verify-email', after);
    const verificationPage = await newcomer.newPage();
    await verificationPage.goto(`${origin}/verify-email#${verification}`);
    await verificationPage
      .getByRole('button', { name: 'Verify email', exact: true })
      .click();
    await expect(
      verificationPage.getByText(/Email verified. You can return/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'I have verified my email' }).click();
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/workspaces/${id}$`));
    const visible = await newcomer.request.get(`${origin}/api/workspaces/${id}`);
    assert.equal((await visible.json()).role, 'EDITOR');
    const second = await browser.newContext();
    assert.equal(
      (
        await post(second, origin, '/api/auth/login', { email: invitedEmail, password })
      ).status(),
      200,
    );
    await page.goto(`${origin}/app/account`);
    await expect(
      page.getByRole('heading', { name: 'Account settings', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Revoke session', exact: true }),
    ).toHaveCount(2);
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page
      .getByLabel('New password', { exact: true })
      .fill('replacement-password-long');
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill('replacement-password-long');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(
      page.getByText('Password changed. Other sessions have been signed out.'),
    ).toBeVisible();
    assert.equal((await second.request.get(`${origin}/api/me`)).status(), 401);
    const recovery = await browser.newContext();
    const recoveryPage = await recovery.newPage();
    await recoveryPage.goto(`${origin}/forgot-password`);
    await recoveryPage.getByLabel('Email', { exact: true }).fill(invitedEmail);
    after = (await readFile(mailLog, 'utf8')).length;
    await recoveryPage
      .getByRole('button', { name: 'Send reset link', exact: true })
      .click();
    await expect(
      recoveryPage.getByText('If an account is eligible, a reset link will be sent.'),
    ).toBeVisible();
    const reset = await mailToken('reset-password', after);
    await recoveryPage.goto(`${origin}/reset-password#${reset}`);
    await recoveryPage
      .getByLabel('New password', { exact: true })
      .fill('reset-password-new-long');
    await recoveryPage
      .getByLabel('Confirm new password', { exact: true })
      .fill('reset-password-new-long');
    await recoveryPage
      .getByRole('button', { name: 'Reset password', exact: true })
      .click();
    await expect(
      recoveryPage.getByText('Password reset. All sessions have been signed out.'),
    ).toBeVisible();
    assert.equal((await newcomer.request.get(`${origin}/api/me`)).status(), 401);
    await recoveryPage.getByRole('link', { name: 'Back to login' }).click();
    await recoveryPage.getByLabel('Email', { exact: true }).fill(invitedEmail);
    await recoveryPage
      .getByLabel('Password', { exact: true })
      .fill('reset-password-new-long');
    await recoveryPage.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(recoveryPage).toHaveURL(`${origin}/app`);
    await recoveryPage.goto(`${origin}/app/account`);
    await expect(
      recoveryPage.getByText('Email verified.', { exact: true }),
    ).toBeVisible();
    await mkdir(path.resolve(__dirname, '../test-results/account-lifecycle'), {
      recursive: true,
    });
    await recoveryPage.screenshot({
      path: path.resolve(
        __dirname,
        '../test-results/account-lifecycle/account-settings.png',
      ),
      fullPage: true,
    });
    await recoveryPage
      .getByRole('button', { name: 'Sign out all sessions', exact: true })
      .click();
    await expect(recoveryPage).toHaveURL(`${origin}/login`);
    console.log(
      'PASS: invitation signup, verification, acceptance, role, password change, session revocation and reset in production UI',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => metadataServer.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
  metadataServer.close();
});
