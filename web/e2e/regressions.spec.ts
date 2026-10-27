import { expect, test, type Page } from '@playwright/test';
import type { ProjectInfo, SessionInfo, SessionState, TownState } from '../src/types';

test.setTimeout(120_000);

const session = (id: string, state: SessionState): SessionInfo => ({ id, name: null, state, lastActivityAt: Date.now() - 1e7 });
const town = (...projects: ProjectInfo[]): TownState => ({ version: 1, generatedAt: Date.now(), dataSourceOk: true, projects });
const office = (sessions: SessionInfo[]): ProjectInfo => ({ id: 'A', name: 'A', color: '#4f8cff', buildingStyle: 'office', sessions });

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?seed=1&gui=0&${query}`);
  await page.waitForFunction(() => window.__projectTownDebug?.ready === true, null, { timeout: 60_000 });
}

const setState = (page: Page, state: TownState) => page.evaluate((s) => window.__projectTownDebug?.setState(s), state);
const characters = (page: Page) => page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? []);

test('WebGL failure under the WKWebView host is reported to Swift as an error', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __msgs: unknown[]; webkit: unknown };
    w.__msgs = [];
    w.webkit = { messageHandlers: { projectTown: { postMessage: (m: unknown) => w.__msgs.push(m) } } };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: never[]) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...rest);
    } as typeof getContext;
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __msgs: unknown[] }).__msgs.length > 0);
  const msgs = await page.evaluate(() => (window as unknown as { __msgs: Array<{ type: string }> }).__msgs);
  expect(msgs.map((m) => m.type)).toContain('error');
});

test('a sleeping session without a window fades in place instead of walking away', async ({ page }) => {
  await open(page, 'scenario=empty');
  const sleepers = Array.from({ length: 200 }, (_, i) => session(`s${String(i).padStart(3, '0')}`, 'sleeping'));
  await setState(page, town(office([...sleepers, session('zz', 'idle')])));
  await page.waitForTimeout(2500);
  const before = (await characters(page)).find((c) => c.id === 'zz');
  expect(before).toBeDefined();

  await setState(page, town(office([...sleepers, session('zz', 'sleeping')])));
  // It fades where it sits for a few hundred ms; sample while it is still there.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(100);
    const now = (await characters(page)).find((c) => c.id === 'zz');
    if (!now) break;
    expect(Math.hypot(now.x - before!.x, now.z - before!.z)).toBeLessThan(0.05);
  }
});

test('canvas is redrawn when the window is resized while paused', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'scenario=busy&time=1792987200000');
  await page.evaluate(() => window.__projectTownDebug?.setPaused(true));
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(500);
  const std = await page.locator('canvas').screenshot().then((png) =>
    page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      let sumSq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += y;
        sumSq += y * y;
      }
      const mean = sum / n;
      return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    }, png.toString('base64')),
  );
  expect(std).toBeGreaterThan(20);
});

test('people who leave while rendering is paused are reclaimed immediately', async ({ page }) => {
  await open(page, 'scenario=empty');
  await setState(page, town(office([session('a', 'running')])));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__projectTownDebug?.setPaused(true));
  await setState(page, town(office([session('b', 'running')])));
  expect((await characters(page)).map((c) => c.id)).toEqual(['b']);
});
