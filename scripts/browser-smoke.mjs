#!/usr/bin/env node
/**
 * Real-browser checks with real three.js and WebGL (software rendering via SwiftShader).
 *
 *   node scripts/browser-smoke.mjs online  <url>   Two players join the online build, see each
 *                                                  other move, and chat. Needs a running server.
 *   node scripts/browser-smoke.mjs preview <dir>   The single-player preview bundle loads, renders
 *                                                  and plays with no server at all.
 *
 * Screenshots go to ./screenshots. Problems are printed as GitHub annotations.
 */
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const GPU_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SHOTS = 'screenshots';
const failures = [];

const annotate = (level, message) => console.log(`::${level}::${String(message).replace(/\r?\n/g, '%0A')}`);
const check = (ok, message) => {
  if (ok) console.log(`ok   ${message}`);
  else {
    console.log(`FAIL ${message}`);
    failures.push(message);
  }
};

async function waitForHealth(url) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(new URL('/healthz', url))).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} never became healthy`);
}

async function openPlayer(browser, url, name) {
  const context = await browser.newContext({ viewport: { width: 900, height: 640 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e?.stack ?? e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const button = document.getElementById('enterBtn');
    return button && !button.disabled;
  }, null, { timeout: 240_000 });
  await page.fill('#nameInput', name);
  await page.click('#enterBtn');
  await page.waitForFunction(
    () => document.body.classList.contains('playing') && typeof window.lanternwood?.debugState.hp === 'number',
    null,
    { timeout: 60_000 },
  );
  return { page, errors, name };
}

const state = (player) => player.page.evaluate(() => window.lanternwood.debugState);

/** Where `viewer` currently sees the hero called `name`, in world blocks. */
const seenAt = async (viewer, name) => (await state(viewer)).players.find((p) => p.name === name) ?? null;
const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 0);

async function walk(player, ms) {
  await player.page.keyboard.down('w');
  await player.page.waitForTimeout(ms);
  await player.page.keyboard.up('w');
}

function report(label, s) {
  annotate('notice', `${label}: ${s.fps} fps, longest frame ${s.longestFrameMs} ms, quality step ${s.quality}, remote players drawn ${s.renderDelayMs} ms behind, ${s.pending} unacknowledged inputs, ${s.corrections} corrections, ${s.snaps} snaps`);
}

function checkRendering(label, s) {
  report(label, s);
  check(s.terrainReady, `${label}: terrain finished building`);
  check(s.drawCalls > 10 && s.triangles > 5000, `${label}: the 3D scene renders (${s.drawCalls} draw calls, ${s.triangles} triangles)`);
  check(s.entities > 0, `${label}: monsters near town are visible (${s.entities})`);
}

async function online(browser, url) {
  await waitForHealth(url);
  const aria = await openPlayer(browser, url, 'Aria');
  const bram = await openPlayer(browser, url, 'Bram');
  const players = [aria, bram];
  try {
    for (const [me, other] of [[aria, bram], [bram, aria]]) {
      await me.page
        .waitForFunction(
          (n) => [...document.querySelectorAll('.np.ally')].some((el) => el.style.display === 'flex' && el.textContent.includes(n)),
          other.name,
          { timeout: 30_000 },
        )
        .then(() => check(true, `${me.name} sees ${other.name}`), () => check(false, `${me.name} sees ${other.name}`));
    }

    const before = await seenAt(bram, 'Aria');
    const ariaBefore = (await state(aria)).position;
    await walk(aria, 1500);
    await bram.page.waitForTimeout(1000);
    const after = await seenAt(bram, 'Aria');
    const ariaAfter = (await state(aria)).position;
    check(distance(ariaBefore, ariaAfter) > 2, `Aria walks (${distance(ariaBefore, ariaAfter).toFixed(1)} blocks)`);
    check(distance(before, after) > 2, `Bram sees Aria move (${distance(before, after).toFixed(1)} blocks)`);
    check(distance(after, ariaAfter) < 1.5, `Bram sees Aria where she is (${distance(after, ariaAfter).toFixed(2)} blocks apart)`);

    await aria.page.keyboard.press('Enter');
    await aria.page.keyboard.type('hello from Aria');
    await aria.page.keyboard.press('Enter');
    await bram.page
      .waitForFunction(() => document.getElementById('log')?.textContent?.includes('hello from Aria'), null, { timeout: 10_000 })
      .then(() => check(true, 'chat reaches the other player'), () => check(false, 'chat reaches the other player'));

    for (const p of players) checkRendering(`online/${p.name}`, await state(p));
  } finally {
    for (const p of players) {
      await p.page.screenshot({ path: join(SHOTS, `online-${p.name.toLowerCase()}.png`) }).catch(() => undefined);
      for (const e of p.errors) failures.push(`online/${p.name} console: ${e}`);
    }
  }
}

function serveDirectory(dir) {
  const root = resolve(dir);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer(async (req, res) => {
    const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`);
    const file = path.startsWith(root + sep) ? path : join(root, 'standalone.html');
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolveUrl) => server.listen(0, '127.0.0.1', () => resolveUrl({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

async function preview(browser, dir) {
  const { server, url } = await serveDirectory(dir);
  let solo;
  try {
    solo = await openPlayer(browser, `${url}standalone.html`, 'Solo');
    check(await solo.page.evaluate(() => document.body.classList.contains('offline')), 'preview runs in single-player mode');
    const joined = await state(solo);
    report('preview right after joining', joined);
    // Let first-use work (shader compilation) finish, as a player would before walking off.
    await solo.page.waitForTimeout(2000);
    const start = await state(solo);
    const trace = [];
    await solo.page.keyboard.down('w');
    for (let i = 0; i < 15; i++) {
      await solo.page.waitForTimeout(100);
      const s = await state(solo);
      trace.push(`${distance(start.position, s.position).toFixed(1)}/${s.pending}/${s.fps}`);
    }
    await solo.page.keyboard.up('w');
    await solo.page.waitForTimeout(500);
    const moved = await state(solo);
    const walked = distance(start.position, moved.position);
    check(walked > 2, `hero walks (${walked.toFixed(1)} blocks)`);
    if (walked <= 2) {
      const server = await solo.page.evaluate(() => window.lanternwoodServerStats?.() ?? null);
      annotate('warning', `walk trace (blocks/pending/fps every 100 ms): ${trace.join(' ')}; corrections ${moved.corrections}, snaps ${moved.snaps}, longest frame ${moved.longestFrameMs} ms, in-page server ${JSON.stringify(server)}`);
    }
    check(moved.pending < 20, `the in-page server acknowledges input (${moved.pending} unacknowledged frames)`);
    await solo.page.keyboard.press('j');
    const journal = await solo.page
      .waitForFunction(() => !document.getElementById('journal')?.hidden && document.querySelectorAll('#jBody .j-row').length >= 4, null, { timeout: 5000 })
      .then(() => true, () => false);
    check(journal, 'the journal opens with every story listed');
    check((await solo.page.textContent('#qObj'))?.includes('Elder Maren') ?? false, 'the tracker points a new hero at Elder Maren');
    await solo.page.keyboard.press('Escape');
    await solo.page.keyboard.press('p');
    const stable = await solo.page
      .waitForFunction(() => !document.getElementById('stable')?.hidden && document.querySelectorAll('#sBody .j-row').length >= 12, null, { timeout: 5000 })
      .then(() => true, () => false);
    check(stable, 'the stable lists every mount and pet');
    await solo.page.keyboard.press('Escape');
    checkRendering('preview', moved);
    check(start.hp > 0, `hero has health (${start.hp})`);
  } finally {
    if (solo) {
      await solo.page.screenshot({ path: join(SHOTS, 'preview.png') }).catch(() => undefined);
      for (const e of solo.errors) failures.push(`preview console: ${e}`);
    }
    server.close();
  }
}

const [mode, target] = process.argv.slice(2);
if (!['online', 'preview'].includes(mode) || !target) {
  console.error('usage: browser-smoke.mjs online <url> | preview <dir>');
  process.exit(2);
}
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: GPU_ARGS });
try {
  if (mode === 'online') await online(browser, target);
  else await preview(browser, target);
} catch (err) {
  failures.push(`${mode}: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
}
for (const f of failures) annotate('error', f.slice(0, 2000));
if (failures.length > 0) {
  console.error(`${failures.length} browser check(s) failed`);
  process.exit(1);
}
annotate('notice', `Browser checks passed (${mode})`);
