// MINIFLARE_DIR=<dir> CHROMIUM_PATH=/usr/bin/chromium node tests/admin-spectate-e2e.mjs
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
  bindings: { ADMIN_CODE: 'K7QM3XRA9DPZW2HF', TEST_ALL_RANKED: '1' },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try { return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[extname(f)] || 'application/octet-stream' } }); } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
});
let browser;
try {
  const url = String(await mf.ready), errors = [];
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  async function player(name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
      await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.waitForFunction(() => Presence.me && Presence.ws?.readyState === 1 && !Screens.busy);
    await page.evaluate(async () => {
      Settings.set('medals.unlocked', Object.fromEntries(Medals.all.map(m => [m.id, 1]))); Medals.queue.length = 0;
      while (Overlays.top()) Overlays.top().close();
      const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
      await App.importFiles([new File([blob], 'test-set.osz')]);
      while (Overlays.top()) Overlays.top().close();
      window.captureCalls = 0;
      const create = GameViewCapture.create;
      GameViewCapture.create = function (...args) { window.captureCalls++; return create.apply(this, args); };
      window.modMessages = [];
      const onmessage = Presence.ws.onmessage;
      Presence.ws.onmessage = e => { const m = JSON.parse(e.data); window.modMessages.push(m); onmessage(e); };
    });
    return page;
  }
  const admin = await player('Moderator'), host = await player('Player');
  const login = await fetch(url + 'admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify({ code: 'K7QM3XRA9DPZW2HF' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0], pid = await admin.evaluate(() => Presence.pid());
  async function api(action, body) {
    const r = await fetch(url + 'admin/api/' + action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1', cookie }, body: JSON.stringify(body) });
    assert.equal(r.status, 200); return r.json();
  }
  await api('role', { pid, name: 'Moderator', colour: '#66ccff' });
  await admin.waitForFunction(() => Presence.isAdmin && Presence.players.some(p => p.name === 'Player'));
  await host.evaluate(() => Screens.go('songselect'));
  await admin.evaluate(() => AdminGameView.request(Presence.players.find(p => p.name === 'Player')));
  await admin.waitForFunction(() => Spectate.target?.silent && document.querySelector('.spm-idle')?.textContent.includes('In song select'));
  await host.waitForFunction(() => Spectate.host.moderators === 1);
  assert.equal(await admin.locator('.spm-msg').count(), 0);
  assert.equal(await host.locator('.spec-host-chat:not([hidden]), .spec-list, .admin-view-sharing').count(), 0);
  assert.equal(await host.evaluate(() => Spectate.host.watchers), 0);
  assert.equal(await host.evaluate(() => window.captureCalls), 0);
  assert.equal(await host.evaluate(() => AdminGameView.current), null);
  assert.doesNotMatch(await host.locator('#toasts').textContent(), /spectating|sharing your game/i);
  // A private form is not part of the replay protocol or the viewer's DOM.
  await host.evaluate(() => {
    const privatePanel = h('div', { id: 'private-test', 'data-private': 'true' }, h('input', { type: 'password', value: 'private-value-7841' }), 'private-panel-7841');
    document.body.append(privatePanel);
    Presence.send({ t: 'status', status: 'menu', activity: 'explore', html: privatePanel.outerHTML });
  });
  await admin.waitForFunction(() => document.querySelector('.spm-idle')?.textContent.includes('Browsing beatmap explorer'));
  assert.equal(await admin.evaluate(() => document.body.textContent.includes('private-panel-7841') || JSON.stringify(window.modMessages).includes('private-value-7841')), false);
  await host.evaluate(() => {
    document.querySelector('#private-test').remove();
    const m = [...BeatmapManager.maps.values()].find(m => m.version === '4K Normal');
    Screens.go('gameplay', { mapId: m.id, mods: ['NF'], force: true });
  });
  await host.waitForFunction(() => Screens.currentName === 'gameplay' && GameplayScreen.s?.running);
  await admin.waitForFunction(() => Screens.currentName === 'gameplay' && !!GameplayScreen.s?.spectate, null, { timeout: 30000 });
  for (let i = 0; i < 12; i++) { await host.keyboard.press(['d', 'f', 'j', 'k'][i % 4]); await host.waitForTimeout(60); }
  await admin.waitForFunction(() => Spectate.cur?.feed.length > 0 && GameplayScreen.loaderGone && GameplayScreen.s?.spectate?.synced && GameplayScreen.s.running && Music.time > 1000, null, { timeout: 30000 });
  assert.match(await admin.locator('.spec-live').textContent(), /Moderation/);
  assert.equal(await admin.locator('.spec-msg, .admin-view-video').count(), 0);
  assert.equal(await host.locator('.spec-list, .admin-view-sharing, .spec-host-chat:not([hidden])').count(), 0);
  assert.equal(await host.evaluate(() => window.captureCalls), 0);
  assert.equal(await admin.evaluate(() => window.modMessages.some(m => m.t.startsWith('adminView') || m.t === 'specChatHist')), false);
  if (process.env.SHOT_DIR) { mkdirSync(process.env.SHOT_DIR, { recursive: true }); await admin.screenshot({ path: join(process.env.SHOT_DIR, 'silent-admin-gameplay.png') }); }
  await api('unrole', { pid });
  await admin.waitForFunction(() => !Spectate.target);
  await host.waitForFunction(() => Spectate.host.moderators === 0);
  console.log('PASS: actual replay playback, public activity, no capture/chat/notification, private-form isolation and immediate role revocation');
  // The separate live interface option still exposes sharing and stop controls on the player.
  await api('role', { pid, name: 'Moderator', colour: '#66ccff' });
  await admin.waitForFunction(() => Presence.isAdmin && !Screens.busy);
  await admin.evaluate(() => AdminGameView.requestInterface(Presence.players.find(p => p.name === 'Player')));
  await admin.getByRole('button', { name: 'Spectate without extra notice', exact: true }).click();
  await host.locator('.admin-view-sharing').waitFor({ timeout: 30000 });
  await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await host.waitForFunction(() => !AdminGameView.current);
  assert.equal(await host.locator('.admin-view-sharing').count(), 0);
  assert.equal(await host.evaluate(() => window.captureCalls), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: live interface remains visibly shared and the player can stop it');
} finally { if (browser) await browser.close(); await mf.dispose(); }
