// MINIFLARE_DIR=<dir> CHROMIUM_PATH=/usr/bin/chromium node tests/weekly-spectator-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const { Miniflare } = createRequire(join(process.env.MINIFLARE_DIR || process.cwd(), 'package.json'))('miniflare');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mf = new Miniflare({ modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, host: '127.0.0.1', port: 0, durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' },
  bindings: { ADMIN_CODE: 'K7QM3XRA9DPZW2HF' },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
});
let browser;
try {
  const url = String(await mf.ready);
  const login = await fetch(url + 'admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify({ code: 'K7QM-3XRA-9DPZ-W2HF' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const chosen = await (await fetch(url + 'admin/api/dailySet', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1', cookie }, body: JSON.stringify({ map: { onlineSetId: 424242, onlineId: 777, keys: 4, title: 'Weekly Song', artist: 'Weekly Artist', version: 'Hard', stars: 4.2 } }) })).json();
  assert.equal(chosen.ok, true);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const mobile of [false, true]) {
    const errors = [], contexts = [];
    async function player(name) {
      const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 960 }, isMobile: mobile, hasTouch: mobile });
      contexts.push(context);
      await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
      if (await page.$('.onboarding')) {
        if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
        await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
        await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
      }
      await page.waitForFunction(() => Presence.me && Presence.ws?.readyState === 1 && !Screens.busy);
      await page.evaluate(() => { while (Overlays.top()) Overlays.top().close(); });
      return page;
    }
    const host = await player(mobile ? 'MobileHost' : 'DesktopHost'), viewer = await player(mobile ? 'MobileViewer' : 'DesktopViewer');
    const id = await host.evaluate(() => Presence.me);
    await host.evaluate(() => Screens.go('songselect'));
    await host.waitForFunction(() => Screens.currentName === 'songselect' && !Screens.busy);
    await viewer.waitForFunction(id => Presence.players.some(p => p.id === id && p.activity === 'songselect'), id);
    await viewer.evaluate(id => Spectate.watch(Presence.players.find(p => p.id === id)), id);
    await viewer.waitForFunction(() => document.querySelector('.spm-idle')?.textContent.includes('In song select'));
    assert.equal(await viewer.locator('.spm-card').count(), 0);
    // An active play still shows its song; with no local copy it stays on the spectator waiting screen.
    await host.evaluate(() => Presence.send({ t: 'play', head: { mapHash: 'missing-map', title: 'Previous Song', artist: 'Artist', version: 'Hard', keys: 4, mods: [], rate: 1, seed: 7 } }));
    await viewer.locator('.spm-card').waitFor();
    assert.match(await viewer.locator('.spm-map').textContent(), /Previous Song/);
    await host.evaluate(() => { Presence.send({ t: 'playEnd', quit: true }); Screens.go('explore'); });
    await viewer.waitForFunction(() => document.querySelector('.spm-idle')?.textContent.includes('Browsing beatmap explorer'));
    assert.equal(await viewer.locator('.spm-card').count(), 0, 'ended songs disappear from the waiting screen');
    for (const [screen, label] of [['home', 'In menus'], ['songselect', 'In song select']]) {
      await host.waitForFunction(() => !Screens.busy);
      await host.evaluate(screen => Screens.go(screen), screen);
      await viewer.waitForFunction(label => document.querySelector('.spm-idle')?.textContent.includes(label), label);
      assert.equal(await viewer.locator('.spm-card').count(), 0);
    }
    if (process.env.SHOT_DIR) { mkdirSync(process.env.SHOT_DIR, { recursive: true }); await viewer.screenshot({ path: join(process.env.SHOT_DIR, mobile ? 'spectator-menu-mobile.png' : 'spectator-menu-desktop.png') }); }
    await viewer.evaluate(() => { Spectate.stop({ quiet: true }); Screens.go('daily'); });
    await viewer.waitForFunction(() => document.querySelector('.dc-title')?.textContent === 'Weekly Song');
    assert.match(await viewer.locator('.ov-titlebar h1').textContent(), /weekly challenge/i);
    const period = await viewer.evaluate(() => ({ period: Daily.data.period, day: Daily.data.day, endsAt: Daily.data.endsAt, startsAt: Daily.data.startsAt, time: document.querySelector('.dc-time b').textContent, sample: [Daily.remaining(6 * 86400000 + 3661000), Daily.remaining(3661000), Daily.remaining(-1000)] }));
    assert.equal(period.period, 'week');
    assert.equal(new Date(period.day + 'T12:00:00Z').getUTCDay(), 1);
    assert.ok(period.endsAt - period.startsAt >= 167 * 3600000 && period.endsAt - period.startsAt <= 169 * 3600000);
    assert.match(period.time, /^(?:\d+d )?\d\d:\d\d:\d\d$/);
    assert.deepEqual(period.sample, ['6d 01:01:01', '01:01:01', '00:00:00']);
    assert.match(await viewer.locator('.dc-kicker').textContent(), /This week's beatmap/);
    assert.match(await viewer.locator('.dc-main').textContent(), /No scores yet this week/);
    await viewer.waitForTimeout(400); // Let the existing menu entrance animation finish before inspecting its layout.
    if (process.env.SHOT_DIR) { mkdirSync(process.env.SHOT_DIR, { recursive: true }); await viewer.screenshot({ path: join(process.env.SHOT_DIR, mobile ? 'weekly-mobile.png' : 'weekly-desktop.png') }); }
    assert.deepEqual(errors, []);
    for (const context of contexts) await context.close();
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: real spectator menu updates, ended-song removal and weekly challenge UI`);
  }
} finally { if (browser) await browser.close(); await mf.dispose(); }
