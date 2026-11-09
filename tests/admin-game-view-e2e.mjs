// MINIFLARE_DIR=<dir> CHROMIUM_PATH=/usr/bin/chromium node tests/admin-game-view-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const { Miniflare } = createRequire(join(process.env.MINIFLARE_DIR || process.cwd(), 'package.json'))('miniflare');
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), code = 'K7QM3XRA9DPZW2HF';
const mf = new Miniflare({
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, host: '127.0.0.1', port: 0,
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' }, bindings: { ADMIN_CODE: code, ADMIN_VIEW_ICE_SERVERS: process.env.ADMIN_VIEW_ICE_SERVERS || '[]' },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try {
      return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(f)] || 'application/octet-stream' } });
    } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
});
let browser;
try {
  const url = String(await mf.ready).replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function device(name) {
    const mobile = process.env.SOURCE_MOBILE === '1' && name === 'Player';
    const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 960 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
      await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.waitForFunction(() => AshtonkMania.Presence.me && AshtonkMania.Account.code());
    await page.evaluate(() => { while (Overlays.top()) Overlays.top().close(); });
    return page;
  }
  const admin = await device('Moderator'), player = await device('Player');
  const visibleVideo = async () => admin.waitForFunction(() => {
    const video = document.querySelector('.admin-view-video');
    if (!video?.videoWidth) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let bright = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 160) bright++;
    return bright > 20;
  });
  await player.evaluate(() => { window.captureCalls = 0; navigator.mediaDevices.getDisplayMedia = async () => { window.captureCalls++; throw new Error('Tab capture must not be used'); }; });
  const pid = await admin.evaluate(() => AshtonkMania.Presence.pid());
  const login = await fetch(url + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify({ code }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const role = await fetch(url + '/admin/api/role', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1', cookie }, body: JSON.stringify({ pid, name: 'Moderator', colour: '#66ccff' }) });
  assert.equal(role.status, 200);
  await admin.waitForFunction(() => AshtonkMania.Presence.isAdmin);
  await admin.waitForFunction(() => AshtonkMania.Presence.players.some(u => u.name === 'Player'));
  for (const page of [admin, player]) await page.evaluate(() => { window.viewMessages = []; window.viewStops = []; const A = AshtonkMania.AdminGameView, stop = A.stop; A.stop = function (...args) { window.viewStops.push({ args, stack: new Error().stack }); return stop.apply(this, args); }; const signal = A.signal; A.signal = async function (...args) { try { return await signal.apply(this, args); } catch (e) { window.viewStops.push({ signalError: e.message }); throw e; } }; const ws = AshtonkMania.Presence.ws, on = ws.onmessage; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t?.startsWith('adminView')) window.viewMessages.push({ ...m, signal: m.signal ? Object.keys(m.signal) : null }); on(e); }; });
  assert.equal(await admin.evaluate(() => {
    const u = AshtonkMania.Presence.players.find(u => u.name === 'Player');
    const items = AshtonkMania.UserPanels.menuItems({ ...u, online: true }), at = items.findIndex(i => i.label === 'Spectate');
    return at >= 0 && items[at + 1].label === 'Admin Spectate';
  }), true, 'Admin Spectate is immediately beside regular Spectate');
  await admin.evaluate(() => AshtonkMania.AdminGameView.request(AshtonkMania.Presence.players.find(u => u.name === 'Player')));
  await admin.getByRole('button', { name: 'Spectate without extra notice', exact: true }).click();
  assert.equal(await player.getByRole('button', { name: 'Share game tab', exact: true }).count(), 0, 'No recurring approval request');
  try { await admin.waitForFunction(() => document.querySelector('.admin-view-video')?.videoWidth > 0, null, { timeout: 30000 }); }
  catch (e) { for (const [label, pg] of [['player', player], ['admin', admin]]) console.error(label, JSON.stringify(await pg.evaluate(() => ({ captureError: AshtonkMania.AdminGameView.current?.captureError, messages: window.viewMessages, stops: window.viewStops, current: AshtonkMania.AdminGameView.current && { host: AshtonkMania.AdminGameView.current.host, session: AshtonkMania.AdminGameView.current.session, pc: AshtonkMania.AdminGameView.current.pc?.connectionState, ice: AshtonkMania.AdminGameView.current.pc?.iceConnectionState, handle: AshtonkMania.AdminGameView.handle }, toasts: document.querySelector('#toasts').textContent })), null, 2)); throw e; }
  assert.equal(await player.evaluate(() => !!AshtonkMania.AdminGameView.current.capture), true, 'The game renders its own UI without display capture');
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.pc.connectionState), 'connected');
  await visibleVideo();
  assert.equal(await admin.locator('.admin-view-video').evaluate(el => {
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && css.opacity === '1' && css.filter === 'none';
  }), true, 'Video fills the viewport without dimming');
  assert.equal(await player.evaluate(() => { const c = AshtonkMania.AdminGameView.current.capture.canvas; return c.width > 0 && c.width <= 1920 && c.height <= 1440 && Math.abs(c.width / c.height - innerWidth / innerHeight) < .01; }), true, 'Adaptive capture preserves aspect ratio at its selected resolution');
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.manual), true, 'Only budgeted frames are submitted to the encoder');
  assert.equal(await player.evaluate(() => window.captureCalls), 0);

  await player.evaluate(() => AshtonkMania.Screens.go('profile'));
  await player.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await player.getByRole('button', { name: 'Aurora profile style', exact: true }).click();
  await admin.waitForFunction(() => document.querySelector('.admin-view-video')?.currentTime > 1);
  await player.getByRole('button', { name: 'Pause sharing', exact: true }).click();
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current?.remotePaused === true);
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.paused), true);
  await player.getByRole('button', { name: 'Resume sharing', exact: true }).click();
  await player.evaluate(() => AshtonkMania.CodePanel.open());
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current?.remotePaused === true);
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.paused), true);
  await admin.waitForFunction(() => {
    const v = document.querySelector('.admin-view-video'); if (!v?.videoWidth) return false;
    const c = document.createElement('canvas'); c.width = c.height = 16; const ctx = c.getContext('2d'); ctx.drawImage(v, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 16, 16).data.every((n, i) => i % 4 === 3 || n < 10);
  });
  await player.evaluate(() => AshtonkMania.CodePanel.close());
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current?.remotePaused === false);
  await player.waitForFunction(() => !!AshtonkMania.AdminGameView.current?.capture?.frame);
  await visibleVideo();
  if (process.env.SHOT_DIR) await admin.screenshot({ path: join(process.env.SHOT_DIR, 'admin-live-game-view.png') });
  await player.evaluate(async () => {
    while (Overlays.top()) Overlays.top().close();
    const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([blob], 'test-set.osz')]);
    while (Overlays.top()) Overlays.top().close();
    const A = AshtonkMania, map = [...A.BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length);
    await A.Game.launch({ mapId: map.id, mods: ['NF'], mode: 'play' });
  });
  try { await player.waitForFunction(() => AshtonkMania.GameplayScreen.s?.running && AshtonkMania.AdminGameView.current?.capture?.liveFrameMode?.startsWith('gameplay/true')); } catch (e) { console.error('Gameplay capture state:', JSON.stringify(await player.evaluate(() => ({ screen: Screens.currentName, running: GameplayScreen.s?.running, state: GameplayScreen.s && { finished: GameplayScreen.s.finished, failed: GameplayScreen.s.failed }, mode: AdminGameView.current?.capture?.frameMode, capturedAgo: performance.now() - (AdminGameView.current?.capture?.captured || 0), videos: [...document.querySelectorAll('video')].map(v => ({ state: v.readyState, paused: v.paused })), private: AdminGameView.privateOpen(), error: AdminGameView.current?.captureError, overlays: Overlays.stack.length, label: AdminGameView.current?.label?.textContent })))); throw e; }
  await visibleVideo();
  if (process.env.SHOT_DIR) await admin.screenshot({ path: join(process.env.SHOT_DIR, process.env.SOURCE_MOBILE ? 'admin-live-gameplay-mobile.png' : 'admin-live-gameplay.png') });
  await player.evaluate(() => AshtonkMania.Screens.go('songselect'));
  await admin.getByRole('button', { name: 'Stop watching', exact: true }).click();
  await player.waitForFunction(() => !AshtonkMania.AdminGameView.current);
  // More than the server's short rejoin cooldown has elapsed during the checks above.
  await admin.evaluate(() => AshtonkMania.AdminGameView.request(AshtonkMania.Presence.players.find(u => u.name === 'Player')));
  await admin.getByRole('button', { name: 'Notify and spectate', exact: true }).click();
  await player.locator('#toasts').filter({ hasText: 'Admin spectating' }).waitFor();
  await visibleVideo();
  assert.equal(await player.evaluate(() => window.captureCalls), 0, 'Rejoining never asks the player to share a tab');
  await player.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await admin.waitForFunction(() => !AshtonkMania.AdminGameView.current);
  assert.equal(await player.locator('.admin-view-sharing').count(), 0);
  console.log('PASS: automatic full-resolution fullscreen in-game WebRTC, adjacent admin button, direct joins, notification choice, zero browser prompts across rejoins, pause/resume, account privacy and player stop');
  for (const pg of [player, admin]) await pg.evaluate(async () => {
    while (Overlays.top()) Overlays.top().close();
    const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([blob], 'test-set.osz')]);
    while (Overlays.top()) Overlays.top().close();
  });
  await player.evaluate(() => { const A = AshtonkMania, map = [...A.BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length); A.Game.launch({ mapId: map.id, mods: ['NF'], mode: 'play' }); });
  await player.waitForFunction(() => AshtonkMania.GameplayScreen.s?.running);
  await admin.evaluate(() => AshtonkMania.Spectate.watch(AshtonkMania.Presence.players.find(u => u.name === 'Player')));
  await admin.waitForFunction(() => AshtonkMania.GameplayScreen.s?.spectate && AshtonkMania.GameplayScreen.s?.running);
  await admin.getByRole('button', { name: 'Open spectator chat', exact: true }).click();
  await admin.getByRole('textbox', { name: 'Spectator chat message', exact: true }).fill('Hello from spectator');
  await admin.getByRole('textbox', { name: 'Spectator chat message', exact: true }).press('Enter');
  await player.getByRole('button', { name: 'Open spectator chat', exact: true }).click();
  await player.locator('.spectator-chat .mp-msg').filter({ hasText: 'Hello from spectator' }).waitFor();
  await player.getByRole('textbox', { name: 'Spectator chat message', exact: true }).fill('Hello from player');
  await player.getByRole('textbox', { name: 'Spectator chat message', exact: true }).press('Enter');
  await admin.locator('.spectator-chat .mp-msg').filter({ hasText: 'Hello from player' }).waitFor();
  await admin.evaluate(() => { window.spectatorScreens = []; AshtonkMania.Bus.on('screen:changed', name => window.spectatorScreens.push(name)); });
  for (let i = 0; i < 2; i++) {
    await admin.evaluate(() => { window.beforeSpectatorRetry = AshtonkMania.GameplayScreen.s; });
    await player.evaluate(() => AshtonkMania.GameplayScreen.retry());
    await admin.waitForFunction(() => AshtonkMania.Screens.currentName === 'gameplay' && AshtonkMania.GameplayScreen.s !== window.beforeSpectatorRetry && AshtonkMania.GameplayScreen.s?.spectate && AshtonkMania.GameplayScreen.s?.running);
    assert.equal(await admin.evaluate(() => AshtonkMania.GameplayScreen.params.quick), true);
    assert.equal(await admin.locator('.gp-loader.spec-retry .pl-card').isVisible(), false);
    assert.equal(await admin.locator('.spectator-chat').count(), 1);
    assert.equal(await player.locator('.spectator-chat').count(), 1);
  }
  assert.equal(await admin.evaluate(() => window.spectatorScreens.includes('spectator')), false);
  assert.equal(await admin.locator('.spectator-chat .mp-msg').count(), 2);
  if (process.env.SHOT_DIR) await admin.screenshot({ path: join(process.env.SHOT_DIR, 'spectator-shared-chat.png') });
  await admin.evaluate(() => AshtonkMania.Spectate.stop({ quiet: true }));
  await player.waitForFunction(() => !AshtonkMania.SpectatorChat.panel && AshtonkMania.Spectate.host.watchers === 0);
  console.log('PASS: player/viewer lounge-style shared chat, messages both ways, two direct retries without the song card, chat survives retry and closes on unwatch');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await mf.dispose(); }
