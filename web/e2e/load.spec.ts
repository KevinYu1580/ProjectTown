import { expect, test } from '@playwright/test';

test('page loads with a canvas and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});

// WKWebView cannot load module scripts from file://, so the build must ship a classic script.
test('built index.html uses a classic script (no type=module / crossorigin)', async ({ request }) => {
  const html = await (await request.get('/index.html')).text();
  expect(html).toMatch(/<script defer src="\.\/assets\/[^"]+\.js"><\/script>/);
  expect(html).not.toContain('type="module"');
  expect(html).not.toContain('crossorigin');
});
