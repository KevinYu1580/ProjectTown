import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Frozen scene times: 2026-10-26 12:00 and 00:00 in Asia/Taipei.
const TIMES = { day: 1792987200000, night: 1792944000000 } as const;
const SCENARIOS = ['empty', 'single', 'busy', 'crowded', 'many', 'unnamed', 'gallery', 'nodata'] as const;
type Scenario = (typeof SCENARIOS)[number];

test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1280, height: 800 } });
test.setTimeout(120_000);

// The animation tests run in real time and never look at pixels, and software WebGL (CI) pays per pixel: they use a
// small window with the same aspect ratio. A frame is at most 100 ms of scene time and CI draws only a few per second,
// so they wait for an animation to end (with a generous deadline) instead of sleeping a few seconds.
const ANIMATION_VIEWPORT = { width: 480, height: 300 };
const WAIT_MS = 60_000;

interface Collected {
  errors: string[];
}

/** Collects console errors and uncaught page errors for the whole test. */
function collectErrors(page: Page): Collected {
  const c: Collected = { errors: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') c.errors.push(msg.text());
  });
  page.on('pageerror', (err) => c.errors.push(err.message));
  return c;
}

async function open(page: Page, scenario: string, query: string): Promise<void> {
  await page.goto(`/?scenario=${scenario}&seed=1&gui=0&${query}`);
  await page.waitForFunction(() => window.__projectTownDebug?.ready === true, null, { timeout: 60_000 });
  // A few more frames so people have settled and fades have finished.
  await page.waitForTimeout(800);
}

/** Draws the PNG into a canvas inside the page and returns the luminance mean and standard deviation. */
async function pixelStats(page: Page, png: Buffer): Promise<{ mean: number; std: number }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
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
    return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
  }, png.toString('base64'));
}

function shotPath(info: TestInfo, name: string): string {
  const dir = join(info.project.outputDir, 'screenshots');
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

async function hudText(page: Page, testid: string): Promise<string> {
  return (await page.getByTestId(testid).first().textContent()) ?? '';
}

/** What the HUD must show, derived from the state the scene was given. */
async function expectedHud(page: Page): Promise<{ projects: number; sessions: number }> {
  return page.evaluate(() => {
    const s = window.__projectTownDebug?.getState();
    if (!s) throw new Error('no state');
    return { projects: s.projects.length, sessions: s.projects.reduce((n, p) => n + p.sessions.length, 0) };
  });
}

const GLYPHS: Record<string, string> = { running: '⚙', waiting: '!', finished: '✓', idle: '…', sleeping: 'zZ' };
const STATE_ORDER = ['running', 'waiting', 'finished', 'idle', 'sleeping'];

/** HUD rows as drawn: name, dot colour and per-state count labels. */
async function hudRows(page: Page): Promise<Array<{ name: string; dot: string; counts: string[] }>> {
  return page.getByTestId('hud-row').evaluateAll((rows) =>
    rows.map((r) => ({
      name: r.querySelector('.hud-name')?.textContent ?? '',
      dot: (r.querySelector('.hud-dot') as HTMLElement | null)?.style.background ?? '',
      counts: [...r.querySelectorAll('.hud-count')].map((c) => c.textContent ?? ''),
    })),
  );
}

/** Rows the HUD should list, worked out from the state with its own glyph table. */
async function expectedHudRows(page: Page): Promise<Array<{ name: string; dot: string; counts: string[] }>> {
  const projects = await page.evaluate(() => window.__projectTownDebug?.getState()?.projects ?? []);
  const listed = projects.length > 8 ? projects.filter((p) => p.sessions.length > 0) : projects;
  return listed.slice(0, 8).map((p) => {
    const n = parseInt(p.color.slice(1), 16);
    return {
      name: p.name,
      dot: `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`,
      counts: STATE_ORDER.map((st) => [st, p.sessions.filter((x) => x.state === st).length] as const)
        .filter(([, k]) => k > 0)
        .map(([st, k]) => `${GLYPHS[st]} ${k}`),
    };
  });
}

for (const scenario of SCENARIOS) {
  for (const tod of ['day', 'night'] as const) {
    test(`${scenario} (${tod}): renders, HUD is correct`, async ({ page }, info) => {
      const c = collectErrors(page);
      await open(page, scenario, `time=${TIMES[tod]}`);

      // Canvas is neither all black nor all white.
      const png = await page.locator('canvas').screenshot();
      const { mean, std } = await pixelStats(page, png);
      expect(mean, 'canvas mean luminance').toBeGreaterThan(5);
      expect(mean, 'canvas mean luminance').toBeLessThan(250);
      expect(std, 'canvas luminance std dev').toBeGreaterThan(4);

      // Light level follows the frozen time.
      const light = await page.evaluate(() => window.__projectTownDebug?.lightInfo());
      expect(light?.phase).toBe(tod);

      const exp = await expectedHud(page);
      await expect(page.getByTestId('hud')).toBeVisible();
      expect(await hudText(page, 'hud-total')).toBe(exp.sessions === 1 ? '1 session' : `${exp.sessions} sessions`);
      const rows = await page.getByTestId('hud-row').count();
      expect(rows).toBeLessThanOrEqual(8);
      expect(await hudRows(page)).toEqual(await expectedHudRows(page));

      const signs = await page.evaluate(() => window.__projectTownDebug?.getSignTexts() ?? []);
      expect(signs.length).toBe(exp.projects);

      switch (scenario) {
        case 'empty':
          expect(rows).toBe(0);
          await expect(page.getByTestId('empty-hint')).toBeVisible();
          await expect(page.getByTestId('empty-hint')).toHaveText('Open Settings from the menu bar to add your first project');
          break;
        case 'single':
          expect(exp.sessions).toBe(5);
          expect(signs[0].lines[1]).toContain('⚙ 1');
          expect(signs[0].lines[1]).toContain('zZ 1');
          expect(signs[0].lines[1]).not.toContain('+');
          // The sleeping session is not drawn as a person.
          expect(await page.evaluate(() => window.__projectTownDebug?.getCharacters().length)).toBe(4);
          break;
        case 'busy':
          expect(rows).toBe(6);
          break;
        case 'crowded':
          expect(exp.sessions).toBe(10);
          expect(signs[0].lines[1]).toContain('+4');
          expect((await hudRows(page))[0].counts).toEqual(['⚙ 3', '! 2', '✓ 2', '… 3']);
          expect(await page.evaluate(() => window.__projectTownDebug?.getCharacters().length)).toBe(6);
          break;
        case 'many': {
          expect(exp.projects).toBe(25);
          expect(rows).toBe(8);
          expect(await hudText(page, 'hud-more')).toMatch(/^\d+ more projects$/);
          break;
        }
        case 'gallery':
          expect(exp.projects).toBe(10);
          expect(rows).toBe(8);
          expect(await hudText(page, 'hud-more')).toBe('1 more project');
          break;
        case 'nodata':
          await expect(page.getByTestId('hud-error')).toHaveText('Claude Code session data not found');
          break;
        case 'unnamed': {
          const state = await page.evaluate(() => window.__projectTownDebug?.getState());
          expect(state?.projects.flatMap((p) => p.sessions).every((x) => x.name === null)).toBe(true);
          const labels = (await page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? [])).map((p) => p.label);
          expect(labels.length).toBeGreaterThan(0);
          for (const l of labels) expect(l).toMatch(/^\(unnamed session\)・(now|\d+ minutes? ago|\d+ hours? ago|yesterday|\d+ days ago)$/);
          break;
        }
      }

      await page.screenshot({ path: shotPath(info, `${scenario}-${tod}.png`) });
      expect(c.errors).toEqual([]);
    });
  }
}

test('lang=zh-Hant: HUD and hint are in Traditional Chinese', async ({ page }) => {
  test.slow(); // five page loads, each a shader compile on software WebGL
  const c = collectErrors(page);
  const totals: Partial<Record<Scenario, string>> = { empty: '0 個 session', single: '5 個 session', crowded: '10 個 session', nodata: '0 個 session' };
  for (const sc of ['empty', 'crowded', 'nodata', 'many', 'single'] as const) {
    await open(page, sc, `time=${TIMES.day}&lang=zh-Hant`);
    expect(await hudText(page, 'hud-total')).toMatch(/^\d+ 個 session$/);
    const total = totals[sc];
    if (total) expect(await hudText(page, 'hud-total')).toBe(total);
    if (sc === 'empty') await expect(page.getByTestId('empty-hint')).toHaveText('從 menubar 開啟設定，新增你的第一個專案');
    if (sc === 'nodata') await expect(page.getByTestId('hud-error')).toHaveText('找不到 Claude Code 的 session 資料');
    if (sc === 'many') expect(await hudText(page, 'hud-more')).toMatch(/^還有 \d+ 個專案$/);
  }
  expect(c.errors).toEqual([]);
});

test('lang=zh-Hant: unnamed sessions are labelled in Traditional Chinese', async ({ page }) => {
  await open(page, 'unnamed', `time=${TIMES.day}&lang=zh-Hant`);
  const labels = (await page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? [])).map((p) => p.label);
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).toMatch(/^\(session 無名稱\)・(現在|\d+ ?分鐘前|\d+ ?小時前|昨天|\d+ ?天前)$/);
});

test('hideSessionNames=false: named labels read "name・relative time"', async ({ page }) => {
  await open(page, 'busy', `time=${TIMES.day}`);
  expect((await page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? [])).every((p) => p.label === null)).toBe(true);
  await page.evaluate(() => {
    const d = window.__projectTownDebug;
    const settings = d?.getSettings();
    if (d && settings) d.applySettings({ ...settings, hideSessionNames: false });
  });
  const labels = (await page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? [])).map((p) => p.label ?? '');
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).toMatch(/^.+・(now|\d+ minutes? ago|\d+ hours? ago|yesterday|\d+ days ago)$/);
});

test('frozen time: the same URL gives identical screenshots', async ({ page }) => {
  test.slow(); // two page loads
  const shots: Buffer[] = [];
  for (let i = 0; i < 2; i++) {
    await open(page, 'busy', `time=${TIMES.night}`);
    shots.push(await page.locator('canvas').screenshot());
  }
  shots.push(await page.locator('canvas').screenshot()); // later frame of the second load
  expect(shots[1].equals(shots[0])).toBe(true);
  expect(shots[2].equals(shots[1])).toBe(true);
});

test('setPaused(true) stops requestAnimationFrame completely', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf++;
      return orig(cb);
    };
  });
  await open(page, 'single', `time=${TIMES.day}`);
  const count = () => page.evaluate(() => (window as unknown as { __raf: number }).__raf);
  await page.evaluate(() => window.__projectTownDebug?.setPaused(true));
  await page.waitForTimeout(200); // let an already-queued callback drain
  const before = await count();
  await page.waitForTimeout(700);
  expect(await count()).toBe(before);
  await page.evaluate(() => window.__projectTownDebug?.setPaused(false));
  await page.waitForTimeout(700);
  expect(await count()).toBeGreaterThan(before);
});

test('camera edit mode shows the toolbar and Done closes it', async ({ page }) => {
  const c = collectErrors(page);
  await open(page, 'busy', `time=${TIMES.day}`);
  await page.evaluate(() => window.__projectTownDebug?.enterCameraEdit());
  await expect(page.getByTestId('camera-toolbar')).toBeVisible();
  const az0 = await page.evaluate(() => window.__projectTownDebug?.cameraAzimuthDeg() ?? 0);
  await page.getByTestId('camera-preset-2').click();
  await page.waitForTimeout(300);
  const az1 = await page.evaluate(() => window.__projectTownDebug?.cameraAzimuthDeg() ?? 0);
  expect(Math.abs(az1 - 135)).toBeLessThan(1);
  expect(Math.abs(az0 - 45)).toBeLessThan(1);
  await page.getByTestId('camera-done').click();
  await expect(page.getByTestId('camera-toolbar')).toHaveCount(0);
  expect(await page.evaluate(() => window.__projectTownDebug?.cameraEditing())).toBe(false);
  expect(c.errors).toEqual([]);
});

test('camera toolbar follows a language change made while editing', async ({ page }) => {
  await open(page, 'busy', `time=${TIMES.day}`);
  await page.evaluate(() => window.__projectTownDebug?.enterCameraEdit());
  await expect(page.getByTestId('camera-done')).toHaveText('Done');
  await page.evaluate(() => {
    const d = window.__projectTownDebug;
    const settings = d?.getSettings();
    if (d && settings) d.applySettings({ ...settings, locale: 'zh-Hant' });
  });
  await expect(page.getByTestId('camera-done')).toHaveText('完成');
  await expect(page.getByTestId('camera-preset-2')).toHaveText('視角 2');
  await expect(page.locator('.ptcam-help')).toHaveText('拖曳旋轉・捲動縮放・右鍵或雙指拖曳平移');
});

type Pos = { id: string; x: number; z: number; state: string };

/** Records every character position on each animation frame into window.__trace. */
async function startTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __trace: Pos[][] };
    w.__trace = [];
    const tick = () => {
      w.__trace.push(window.__projectTownDebug?.getCharacters() ?? []);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const traceLength = (page: Page) => page.evaluate(() => (window as unknown as { __trace: Pos[][] }).__trace.length);

/** Positions of one person from the frame before `from` (so a snap at the moment of the change is seen) to the end. */
async function pathOf(page: Page, id: string, from: number): Promise<Array<{ x: number; z: number }>> {
  return page.evaluate(
    ([pid, a]) => {
      const w = window as unknown as { __trace: Pos[][] };
      return w.__trace
        .slice(Math.max(0, (a as number) - 1))
        .map((f) => f.find((q) => q.id === pid))
        .filter((p): p is Pos => !!p)
        .map((p) => ({ x: p.x, z: p.z }));
    },
    [id, from] as const,
  );
}

/** Waits until the person has moved and then stood still for three frames, i.e. the walk is over. */
async function walkedAndStopped(page: Page, id: string, from: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const path = await pathOf(page, id, from);
        const last = path[path.length - 1];
        const rested = path.length >= 4 && path.slice(-3).every((p) => p.x === last.x && p.z === last.z);
        return rested && path.some((p) => p.x !== path[0].x || p.z !== path[0].z);
      },
      { timeout: WAIT_MS, intervals: [250] },
    )
    .toBe(true);
}

const steps = (path: Array<{ x: number; z: number }>) => path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.z - path[i].z));
/** Distinct positions visited strictly between the first and last sample. */
const intermediates = (path: Array<{ x: number; z: number }>) => {
  const first = path[0];
  const last = path[path.length - 1];
  const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  return new Set(path.filter((p) => key(p) !== key(first) && key(p) !== key(last)).map(key)).size;
};

/** Rewrites the first project's sessions in the live state: `state` for one session, or removes it when null. */
async function editSession(page: Page, id: string, state: string | null): Promise<void> {
  await page.evaluate(
    ([pid, st]) => {
      const d = window.__projectTownDebug;
      const s = structuredClone(d?.getState());
      if (!d || !s) return;
      const sessions = s.projects[0].sessions;
      const idx = sessions.findIndex((q) => q.id === pid);
      if (idx < 0) return;
      if (st === null) sessions.splice(idx, 1);
      else {
        sessions[idx].state = st as (typeof sessions)[number]['state'];
        sessions[idx].lastActivityAt = Date.now();
      }
      d.setState(s);
    },
    [id, state] as const,
  );
}

// Leaving walks at 3 m/s and a frame is at most 100 ms of scene time, so one step is about 0.3 m.
const MAX_LEAVE_STEP = 0.5;

/**
 * A state-change walk lasts 0.7-2.2 s, so even at 100 ms frames and peak speed (1.25x average) one step is under
 * 18 % of the hop. A snap would be 100 % of it in a single frame.
 */
function expectWalked(path: Array<{ x: number; z: number }>, what: string): void {
  const s = steps(path);
  const hop = s.reduce((a, b) => a + b, 0);
  expect(hop, `${what}: moved`).toBeGreaterThan(0.5);
  expect(Math.max(...s), `${what}: largest step of a ${hop.toFixed(1)} m hop`).toBeLessThan(0.4 * hop);
  expect(intermediates(path), `${what}: intermediate positions`).toBeGreaterThanOrEqual(3);
}

test('state changes move people smoothly (no teleporting)', async ({ page }) => {
  const c = collectErrors(page);
  await page.setViewportSize(ANIMATION_VIEWPORT);
  await open(page, 'single', 'x=1');
  await startTrace(page);
  const id = await page.evaluate(() => window.__projectTownDebug?.getCharacters().find((p) => p.state === 'idle')?.id ?? '');
  expect(id).not.toBe('');
  const chain = ['running', 'waiting', 'finished', 'idle'];
  for (const st of chain) {
    const from = await traceLength(page);
    await editSession(page, id, st);
    await walkedAndStopped(page, id, from);
    const path = await pathOf(page, id, from);
    // Every hop (including waiting -> finished, about 1.3 m) is walked, never snapped.
    expectWalked(path, `into ${st}`);
  }
  const end = await page.evaluate((pid) => window.__projectTownDebug?.getCharacters().find((p) => p.id === pid), id);
  expect(end?.state).toBe('idle');
  expect(c.errors).toEqual([]);
});

test('a removed session walks to the road and then disappears', async ({ page }) => {
  const c = collectErrors(page);
  await page.setViewportSize(ANIMATION_VIEWPORT);
  await open(page, 'single', 'x=1');
  await startTrace(page);
  const id = await page.evaluate(() => window.__projectTownDebug?.getCharacters().find((p) => p.state === 'running')?.id ?? '');
  expect(id).not.toBe('');
  const from = await traceLength(page);
  await editSession(page, id, null);
  await page.waitForTimeout(1000);
  const present = () => page.evaluate((pid) => !!window.__projectTownDebug?.getCharacters().some((p) => p.id === pid), id);
  expect(await present(), 'still walking after 1 s').toBe(true);
  await expect.poll(present, { timeout: WAIT_MS, intervals: [250] }).toBe(false);
  const path = await pathOf(page, id, from);
  const travelled = Math.hypot(path[path.length - 1].x - path[0].x, path[path.length - 1].z - path[0].z);
  expect(travelled, 'distance walked before vanishing').toBeGreaterThan(4);
  expect(Math.max(...steps(path))).toBeLessThan(MAX_LEAVE_STEP);
  expect(intermediates(path)).toBeGreaterThanOrEqual(5);
  expect(c.errors).toEqual([]);
});

test('a session that falls asleep fades out where it sits and shows zZ on the sign', async ({ page }) => {
  const c = collectErrors(page);
  await page.setViewportSize(ANIMATION_VIEWPORT);
  await open(page, 'single', 'x=1');
  await startTrace(page);
  const id = await page.evaluate(() => window.__projectTownDebug?.getCharacters().find((p) => p.state === 'idle')?.id ?? '');
  expect(id).not.toBe('');
  const before = await page.evaluate(() => window.__projectTownDebug?.getSignTexts()[0].lines[1] ?? '');
  expect(before).toContain('zZ 1');
  const from = await traceLength(page);
  await editSession(page, id, 'sleeping');
  const present = () => page.evaluate((pid) => !!window.__projectTownDebug?.getCharacters().some((p) => p.id === pid), id);
  await expect.poll(present, { timeout: WAIT_MS, intervals: [250] }).toBe(false);
  const path = await pathOf(page, id, from);
  expect(Math.max(0, ...steps(path)), 'a sleeper fades in place').toBeLessThan(0.01);
  const after = await page.evaluate(() => window.__projectTownDebug?.getSignTexts()[0].lines[1] ?? '');
  expect(after).toContain('zZ 2');
  expect(c.errors).toEqual([]);
});

test('a hidden session takes the place of a removed one in a crowded lot', async ({ page }) => {
  const c = collectErrors(page);
  await page.setViewportSize(ANIMATION_VIEWPORT);
  await open(page, 'crowded', 'x=1');
  await startTrace(page);
  const chars = () => page.evaluate(() => window.__projectTownDebug?.getCharacters() ?? []);
  const first = await chars();
  expect(first.length).toBe(6);
  const sign = () => page.evaluate(() => window.__projectTownDebug?.getSignTexts()[0].lines[1] ?? '');
  expect(await sign()).toContain('+4');
  const from = await traceLength(page);
  await editSession(page, first[0].id, null);
  // The removed person walks off for a few seconds; afterwards only the 6 visible ones remain.
  await expect.poll(async () => (await chars()).length, { timeout: WAIT_MS, intervals: [250] }).toBe(6);
  const now = await chars();
  expect(now.some((p) => p.id === first[0].id)).toBe(false);
  const newcomer = now.find((p) => !first.some((q) => q.id === p.id));
  expect(newcomer, 'a previously hidden session is drawn').toBeDefined();
  expect(await sign()).toContain('+3');
  const path = await pathOf(page, newcomer?.id ?? '', from);
  expectWalked(path, 'newcomer walking in');
  expect(c.errors).toEqual([]);
});
