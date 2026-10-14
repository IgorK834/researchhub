/* Production UI -> Spring -> PostgreSQL. Synthetic account; no Gemini/model or translation service calls. */
const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer, request } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const backend = process.env.E2E_BACKEND_URL;
const workspace = process.env.E2E_WORKSPACE_ID;
const email = process.env.E2E_EMAIL;
const security = require('../dist/security-headers.json');
const artifacts = path.resolve('../backend/target/templates-browser');
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
const labels = {
  en: {
    language: 'Interface language',
    title: 'Document title',
    structure: 'Starting structure',
    templateLanguage: 'Template language',
    preview: 'Template preview',
    create: 'Create document',
    cancel: 'Cancel',
    new: 'New document',
    first: 'Create first document',
    export: 'Export',
    exportLanguage: 'Export language',
    generate: 'Generate export',
  },
  pl: {
    language: 'Język interfejsu',
    title: 'Tytuł dokumentu',
    structure: 'Struktura początkowa',
    templateLanguage: 'Język szablonu',
    preview: 'Podgląd szablonu',
    create: 'Utwórz dokument',
    cancel: 'Anuluj',
    new: 'Nowy dokument',
    first: 'Utwórz pierwszy dokument',
    export: 'Eksport',
    exportLanguage: 'Język eksportu',
    generate: 'Wygeneruj eksport',
  },
};
(async () => {
  let browser;
  const errors = [];
  const results = [];
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
    async function login(page) {
      await page.goto(`${origin}/login`);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery-staple');
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await page.waitForURL('**/app');
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel('Interface language', { exact: true }).selectOption('pl');
    await expect(page.getByRole('heading', { name: /Badajcie razem/ })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Język interfejsu', { exact: true })).toHaveValue('pl');
    await page.getByLabel('Język interfejsu', { exact: true }).selectOption('en');
    await login(page);
    const other = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const peer = await other.newPage();
    await login(peer);
    await page.getByLabel('Interface language', { exact: true }).selectOption('pl');
    await peer.reload();
    await expect(peer.getByLabel('Interface language', { exact: true })).toHaveValue(
      'en',
    );
    let created;
    for (const locale of ['pl', 'en']) {
      const l = labels[locale];
      await page.goto(`${origin}/app/workspaces/${workspace}/documents`);
      await page
        .getByLabel(labels[locale === 'pl' ? 'pl' : 'pl'].language, { exact: true })
        .selectOption(locale);
      const trigger =
        locale === 'pl'
          ? page.getByRole('button', { name: l.first, exact: true })
          : page.getByRole('button', { name: l.new, exact: true }).last();
      await trigger.click();
      let dialog = page.getByRole('dialog', { name: l.new, exact: true });
      await dialog.getByLabel(l.structure, { exact: true }).selectOption('TEMPLATE');
      await expect(
        dialog.getByRole('region', { name: l.preview, exact: true }),
      ).toBeVisible();
      await expect(dialog.getByLabel(l.templateLanguage, { exact: true })).toHaveValue(
        locale,
      );
      await dialog
        .getByLabel(l.title, { exact: true })
        .fill(`Unchanged measured 1.25 m ${locale}`);
      const violations = (
        await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
      ).violations;
      assert.deepEqual(violations, [], JSON.stringify(violations));
      await page.screenshot({ path: path.join(artifacts, `preview-${locale}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      assert.equal(
        (
          await (
            await page.request.get(`${origin}/api/workspaces/${workspace}/documents`)
          ).json()
        ).length,
        locale === 'pl' ? 0 : 1,
      );
      await trigger.click();
      dialog = page.getByRole('dialog', { name: l.new, exact: true });
      await dialog.getByLabel(l.structure, { exact: true }).selectOption('TEMPLATE');
      await expect(
        dialog.getByRole('region', { name: l.preview, exact: true }),
      ).toBeVisible();
      await dialog
        .getByLabel(l.title, { exact: true })
        .fill(`Unchanged measured 1.25 m ${locale}`);
      const requestPromise = page.waitForRequest(
        (r) => r.url().endsWith('/documents/from-template') && r.method() === 'POST',
      );
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().endsWith('/documents/from-template') && r.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: l.create, exact: true }).click();
      const req = await requestPromise;
      const response = await responsePromise;
      assert.equal(response.status(), 201);
      created = await response.json();
      await page.waitForURL(`**/documents/${created.id}`);
      assert.ok(JSON.stringify(created.content).includes('[TODO:'));
      assert.ok(!JSON.stringify(created.content).includes('researchCitation'));
      assert.equal(req.postDataJSON().locale, locale);
      const retry = await page.request.post(req.url(), {
        data: req.postDataJSON(),
        headers: { 'X-XSRF-TOKEN': req.headers()['x-xsrf-token'] },
      });
      assert.equal(retry.status(), 201);
      assert.equal((await retry.json()).id, created.id);
      await page
        .getByLabel(l.language, { exact: true })
        .selectOption(locale === 'pl' ? 'en' : 'pl');
      await page.reload();
      await expect(
        page.getByLabel(labels[locale === 'pl' ? 'en' : 'pl'].language, { exact: true }),
      ).toHaveValue(locale === 'pl' ? 'en' : 'pl');
      const stored = await (
        await page.request.get(
          `${origin}/api/workspaces/${workspace}/documents/${created.id}`,
        )
      ).json();
      assert.deepEqual(stored.content, created.content);
      assert.equal(stored.title, created.title);
      await page
        .getByLabel(labels[locale === 'pl' ? 'en' : 'pl'].language, { exact: true })
        .selectOption(locale);
      await page.screenshot({ path: path.join(artifacts, `document-${locale}.png`) });
      await page.getByRole('button', { name: l.export, exact: true }).click();
      const exportDialog = page.getByRole('dialog', {
        name: locale === 'pl' ? 'Eksportuj dokument' : 'Export document',
        exact: true,
      });
      await expect(
        exportDialog.getByLabel(l.exportLanguage, { exact: true }),
      ).toHaveValue('en');
      await exportDialog.getByLabel(l.exportLanguage, { exact: true }).selectOption('pl');
      const exportResponse = page.waitForResponse(
        (r) => r.url().endsWith('/exports') && r.request().method() === 'POST',
      );
      await exportDialog.getByRole('button', { name: l.generate, exact: true }).click();
      const queuedResponse = await exportResponse;
      assert.equal(queuedResponse.status(), 202);
      const job = await queuedResponse.json();
      const report = await (
        await page.request.get(
          `${origin}/api/workspaces/${workspace}/documents/${created.id}/exports/${job.id}/representation`,
        )
      ).json();
      assert.equal(report.exportLanguage, 'pl');
      assert.equal(report.citationStyle, 'APA_7');
      await expect(
        exportDialog.getByRole('button', {
          name: locale === 'pl' ? 'Pobierz DOCX' : 'Download DOCX',
          exact: true,
        }),
      ).toBeVisible();
      const downloaded = page.waitForEvent('download');
      await exportDialog
        .getByRole('button', {
          name: locale === 'pl' ? 'Pobierz DOCX' : 'Download DOCX',
          exact: true,
        })
        .click();
      await (await downloaded).saveAs(path.join(artifacts, `template-${locale}.docx`));
      await exportDialog
        .getByRole('button', { name: locale === 'pl' ? 'Zamknij' : 'Close', exact: true })
        .last()
        .click();
      results.push({
        locale,
        documentId: created.id,
        templateLocale: req.postDataJSON().locale,
        exportLanguage: report.exportLanguage,
      });
    }
    await page.goto(`${origin}/app/workspaces/${workspace}/documents`);
    await page.getByRole('button', { name: 'New document', exact: true }).last().click();
    const quotaDialog = page.getByRole('dialog', { name: 'New document', exact: true });
    await quotaDialog
      .getByLabel('Starting structure', { exact: true })
      .selectOption('TEMPLATE');
    await expect(
      quotaDialog.getByRole('region', { name: 'Template preview' }),
    ).toBeVisible();
    await quotaDialog.getByLabel('Document title').fill('Quota kept my title');
    await quotaDialog.getByRole('button', { name: 'Create document' }).click();
    await expect(quotaDialog.locator('form').getByRole('alert')).toContainText(
      'document limit',
    );
    await expect(quotaDialog.getByLabel('Document title')).toHaveValue(
      'Quota kept my title',
    );
    assert.equal(
      (
        await (
          await page.request.get(`${origin}/api/workspaces/${workspace}/documents`)
        ).json()
      ).length,
      2,
    );
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(artifacts, 'summary.json'),
      JSON.stringify(
        {
          results,
          consoleErrors: errors,
          checks: [
            'PL/EN preview and creation',
            'escape/focus/cancel',
            'reload',
            'shared-account isolation',
            'unchanged content and canonical 1.25',
            'idempotent replay',
            'explicit export language',
            'DOCX downloads',
            'quota',
            'axe dialog checks',
          ],
        },
        null,
        2,
      ),
    );
    process.stdout.write('PL/EN document template browser flows passed.\n');
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})();
