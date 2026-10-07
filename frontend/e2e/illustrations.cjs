/* Production artwork/layout smoke test; fixtures never touch a product database. */
/* global document, window, innerWidth, innerHeight */
const { chromium, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const dist = path.resolve(__dirname, '../dist');
const security = require('../dist/security-headers.json');
const artifacts =
  process.env.ILLUSTRATION_ARTIFACTS ?? '/private/tmp/researchhub-illustrations';
const timestamp = '2026-10-07T10:00:00Z';
const workspace = {
  id: 'w',
  name: 'Research workspace',
  description: 'Evidence, notes and results.',
  role: 'OWNER',
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
};
const user = {
  id: 'u',
  displayName: 'Researcher',
  email: 'researcher@example.test',
  status: 'ACTIVE',
};
const doc = {
  id: 'd',
  title: 'Research notes',
  contentFormat: 'PROSEMIRROR_JSON',
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
};
const source = {
  id: 's',
  displayName: 'Research.pdf',
  sourceType: 'PDF',
  status: 'READY',
  sizeBytes: 200,
  uploadedBy: 'u',
  createdAt: timestamp,
  updatedAt: timestamp,
  activeVersionId: 'sv',
  activeVersionNumber: 1,
  failureSummary: null,
};
const conversation = {
  id: 'c',
  workspaceId: 'w',
  createdBy: 'u',
  title: 'Evidence check',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const server = createServer(async (req, res) => {
  const filename = path.resolve(
    dist,
    '.' + new URL(req.url, 'http://localhost').pathname,
  );
  if (!filename.startsWith(dist + path.sep)) {
    res.writeHead(400);
    res.end();
    return;
  }
  const asset = /\.(js|css|svg|woff2?|txt|json)$/.test(filename);
  const file = asset ? filename : path.join(dist, 'index.html');
  const types = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.html': 'text/html',
  };
  try {
    for (const [name, value] of Object.entries(security.headers))
      res.setHeader(name, value);
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'text/plain');
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
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage();
    const errors = [],
      unexpected = [],
      checks = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        window.cspViolations.push(event.effectiveDirective),
      );
    });
    let state = 'empty';
    let releaseAuthoring;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      let body;
      if (state === 'error' && p.endsWith('/sources')) {
        await route.fulfill({
          status: 503,
          json: {
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            detail: 'Sources temporarily unavailable.',
          },
        });
        return;
      }
      if (p === '/api/me') body = user;
      else if (p === '/api/auth/csrf') {
        await route.fulfill({
          status: 204,
          headers: { 'set-cookie': 'XSRF-TOKEN=illustration-test; Path=/' },
        });
        return;
      } else if (p === '/api/workspaces') body = state === 'home' ? [] : [workspace];
      else if (p === '/api/workspaces/w')
        body = { ...workspace, role: state === 'viewer' ? 'VIEWER' : 'OWNER' };
      else if (p.endsWith('/members'))
        body = [
          {
            userId: 'u',
            email: user.email,
            displayName: user.displayName,
            role: 'OWNER',
          },
        ];
      else if (p.endsWith('/sources'))
        body = ['filtered', 'authoring'].includes(state) ? [source] : [];
      else if (p.endsWith('/documents')) body = state === 'filtered' ? [doc] : [];
      else if (p.endsWith('/documents/d')) body = doc;
      else if (
        p.endsWith('/versions') ||
        p.endsWith('/analyses') ||
        p.endsWith('/comments')
      )
        body = [];
      else if (p.endsWith('/ai/conversations'))
        body = { items: state === 'evidence' ? [conversation] : [], nextOffset: null };
      else if (p.endsWith('/ai/conversations/c'))
        body = {
          conversation,
          nextBeforeSequence: null,
          messages: [
            {
              id: 'm',
              clientRequestId: 'r',
              sequence: 1,
              role: 'ASSISTANT',
              status: 'COMPLETED',
              authorId: null,
              content: '',
              selectedSourceIds: null,
              errorCode: null,
              createdAt: timestamp,
              completedAt: timestamp,
              response: {
                status: 'INSUFFICIENT_EVIDENCE',
                reason: 'NO_RETRIEVED_EVIDENCE',
                answer: '',
                citations: [],
                generation: null,
              },
            },
          ],
        };
      else if (p.endsWith('/provenance')) body = [];
      else if (p.endsWith('/ai/suggestions')) {
        await new Promise((resolve) => {
          releaseAuthoring = resolve;
        });
        body = {
          id: 'suggestion',
          workspaceId: 'w',
          documentId: 'd',
          createdBy: 'u',
          state: 'PENDING',
          command: route.request().postDataJSON(),
          originalText: '',
          generatedText: '',
          citations: [],
          candidates: [],
          warnings: [],
          generation: null,
          acceptedRevision: null,
        };
      } else {
        unexpected.push(p);
        await route.fulfill({
          status: 404,
          json: { status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'Missing fixture' },
        });
        return;
      }
      await route.fulfill({ json: body });
    });

    async function geometry(label) {
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page
            .locator('[data-illustration]')
            .evaluateAll((imgs) =>
              imgs.every((img) => img.complete && img.naturalWidth > 0),
            ),
        )
        .toBe(true);
      const result = await page.locator('[data-illustration]').evaluateAll((imgs) =>
        imgs
          .filter((img) => img.getClientRects().length && !img.closest('[inert]'))
          .map((img) => {
            const r = img.getBoundingClientRect(),
              parent = img.parentElement.getBoundingClientRect();
            const x = r.left + r.width / 2,
              y = r.top + r.height / 2;
            const visibleCenter = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
            return {
              scene: img.dataset.illustration,
              width: r.width,
              height: r.height,
              fits: r.left >= parent.left - 1 && r.right <= parent.right + 1,
              uncovered:
                !visibleCenter ||
                img.parentElement.contains(document.elementFromPoint(x, y)),
              ratio:
                Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) <
                0.02,
              decorative:
                img.alt === '' &&
                img.getAttribute('aria-hidden') === 'true' &&
                !img.draggable,
            };
          }),
      );
      for (const item of result)
        assert(
          item.fits && item.ratio && item.decorative && item.uncovered,
          `${label}: ${JSON.stringify(item)}`,
        );
      assert.deepEqual(
        await page.evaluate(() => window.cspViolations),
        [],
        label + ': CSP',
      );
      checks.push({
        label,
        illustrations: result.map((item) => item.scene),
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        overflowElements: await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth + 1
            ? []
            : [...document.querySelectorAll('main *, header *')]
                .filter(
                  (el) =>
                    el.getClientRects().length &&
                    el.getBoundingClientRect().right > innerWidth + 1,
                )
                .slice(0, 6)
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  right: el.getBoundingClientRect().right,
                  text: el.textContent.slice(0, 40),
                })),
        ),
      });
      if (result.length && [375, 1440].includes(page.viewportSize().width)) {
        await page.screenshot({
          path: path.join(artifacts, `${label.replaceAll('/', '-')}.png`),
          fullPage: true,
        });
      }
    }
    async function visit(route, scene, label) {
      await page.goto(origin + route);
      if (scene)
        await expect(
          page.locator(`[data-illustration="${scene}"]`).first(),
        ).toBeVisible();
      await geometry(label);
    }
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      state = 'empty';
      for (const [route, scene] of [
        ['/login', 'reading'],
        ['/register', 'team'],
      ]) {
        await visit(route, width > 800 ? scene : null, `${width}${route}`);
        if (width <= 800)
          await expect(page.locator(`[data-illustration="${scene}"]`)).toBeHidden();
      }
      state = 'home';
      await visit('/app', 'workspace', `${width}/app`);
      await page
        .getByRole('button', { name: 'Create workspace', exact: true })
        .last()
        .click();
      await expect(page.getByRole('dialog', { name: 'Create workspace' })).toBeVisible();
      await page.keyboard.press('Escape');
      state = 'empty';
      for (const [route, scene] of [
        ['', 'documents'],
        ['/documents', 'documents'],
        ['/sources', 'sources'],
        ['/analyses', 'analyses'],
        ['/analyses/new', 'sources'],
        ['/ask', 'hero'],
      ]) {
        await visit('/app/workspaces/w' + route, scene, `${width}/workspace${route}`);
      }
      state = 'filtered';
      await visit('/app/workspaces/w/documents', null, `${width}/documents-populated`);
      await page.getByLabel('Search documents', { exact: true }).fill('missing title');
      await expect(page.locator('[data-illustration="search"]')).toBeVisible();
      await geometry(`${width}/document-filter`);
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(
        page.getByRole('link', { name: doc.title, exact: true }).last(),
      ).toBeVisible();
      await visit('/app/workspaces/w/sources', null, `${width}/sources-populated`);
      await page.getByRole('tab', { name: 'TXT 0' }).click();
      await expect(page.locator('[data-illustration="search"]')).toBeVisible();
      await geometry(`${width}/source-filter`);
      await page.getByRole('button', { name: 'Show all sources' }).click();
      await expect(
        page.getByRole('link', { name: source.displayName, exact: true }),
      ).toBeVisible();
      state = 'evidence';
      await visit('/app/workspaces/w/ask', 'evidence', `${width}/no-evidence`);
      state = 'viewer';
      await visit('/app/workspaces/w/documents', 'documents', `${width}/viewer`);
      await expect(
        page.getByRole('button', { name: 'Create first document' }),
      ).toHaveCount(0);
      if ([375, 1024, 1440].includes(width)) {
        state = 'authoring';
        await visit(
          '/app/workspaces/w/documents/d',
          'documents',
          `${width}/document-column`,
        );
        await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
        await expect(
          page.locator('[data-illustration="magnifier"]').first(),
        ).toBeVisible();
        await geometry(`${width}/document-research-panel`);
        await page.getByRole('tab', { name: 'Writing', exact: true }).click();
        await expect(page.locator('[data-illustration="laptop"]')).toBeVisible();
        await geometry(`${width}/document-writing-panel`);
        if (width === 375) {
          await page
            .getByRole('checkbox', { name: source.displayName, exact: true })
            .check();
          await page
            .getByLabel('Title or instruction', { exact: true })
            .fill('Summarize the research.');
          await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
          await expect(page.locator('[data-illustration="thinking"]')).toBeVisible();
          await geometry(`${width}/authoring-thinking`);
          await expect.poll(() => typeof releaseAuthoring).toBe('function');
          releaseAuthoring();
          await expect(
            page.getByText('Insufficient evidence', { exact: true }),
          ).toBeVisible();
        }
      }
      state = 'error';
      await page.goto(origin + '/app/workspaces/w/sources');
      await expect(
        page.getByRole('alert').filter({ hasText: 'Sources temporarily unavailable.' }),
      ).toBeVisible();
      await expect(page.locator('[data-illustration]')).toHaveCount(0);
      await geometry(`${width}/source-error`);
      await visit('/missing', 'search', `${width}/missing`);
      if (width === 375 || width === 1440)
        await page.screenshot({
          path: path.join(artifacts, `missing-${width}.png`),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, [], 'Browser errors');
    assert.deepEqual(unexpected, [], 'Unexpected fixture requests');
    assert.deepEqual(
      checks.filter((check) => check.overflow),
      [],
      'Horizontal page overflow',
    );
    const coveredScenes = [
      ...new Set(checks.flatMap((check) => check.illustrations)),
    ].sort();
    assert.deepEqual(coveredScenes, [
      'analyses',
      'documents',
      'evidence',
      'hero',
      'laptop',
      'magnifier',
      'reading',
      'search',
      'sources',
      'team',
      'thinking',
      'workspace',
    ]);
    await writeFile(
      path.join(artifacts, 'results.json'),
      JSON.stringify({ checks, coveredScenes, errors }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          checks: checks.length,
          overflows: checks.filter((check) => check.overflow),
          artifacts,
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
