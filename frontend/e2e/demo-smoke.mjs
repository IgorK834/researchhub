import { readFile, mkdir } from 'node:fs/promises';
import process from 'node:process';
import { log } from 'node:console';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const state = path.resolve(process.env.DEMO_STATE ?? path.join(root, '.demo/local'));
const url = 'https://localhost:8443';
const accounts = JSON.parse(
  await readFile(path.join(state, 'accounts.json'), 'utf8'),
).accounts;
const manifest = JSON.parse(
  await readFile(path.join(state, 'seed-manifest.json'), 'utf8'),
);
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined),
  args: ['--ignore-certificate-errors'],
});
try {
  const contexts = [];
  for (const slug of ['demo-editor', 'collaboration-editor']) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(url + '/login');
    await expect(page.getByText(/Portfolio demo environment/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill(accounts[slug].email);
    await page.getByLabel('Password', { exact: true }).fill(accounts[slug].password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/app');
    await page.goto(url + '/app/workspaces/' + manifest.workspaceId + '/ask');
    await expect(
      page.getByText(/Fixture AI \(deterministic\)|Live model: /),
    ).toBeVisible();
    const socket = page.waitForEvent('websocket');
    await page.goto(
      url +
        '/app/workspaces/' +
        manifest.workspaceId +
        '/documents/' +
        manifest.documentId,
    );
    expect((await socket).url()).toBe('wss://localhost:8443/collaboration');
    await expect(
      page.getByText('RC Circuit Laboratory Report', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    });
    expect(
      (await context.cookies()).find((cookie) => cookie.name === 'JSESSIONID')?.secure,
    ).toBe(true);
  }
  await mkdir(path.join(state, 'browser'), { recursive: true });
  await contexts[0]
    .pages()[0]
    .screenshot({ path: path.join(state, 'browser/workspace.png'), fullPage: true });
  const page = contexts[0].pages()[0];
  await page.goto(url + '/register');
  await expect(
    page.getByRole('heading', { name: 'Registration unavailable' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  log(
    'Browser smoke passed: demo banner, fixture chip, two secure sessions, same-origin WebSockets and closed registration.',
  );
} finally {
  await browser.close();
}
