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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...(process.env.EXACT_TAB === '1' ? ['--auto-select-tab-capture-source-by-title=Exact game tab test', '--allow-http-screen-capture', '--enable-usermedia-screen-capturing'] : [])] });
  const system = await browser.newBrowserCDPSession(), gpu = await system.send('SystemInfo.getInfo'); await system.detach();
  const softwareGPU = gpu.gpu.devices.some(d => /SwiftShader|llvmpipe|software/i.test(d.deviceString || ''));
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
    const menu = AshtonkMania.AdminGameView.current?.menu;
    if (menu?.active && !menu.paused && !menu.el.hidden && menu.updates > 0) return menu.iframe.contentDocument.body.textContent.trim().length > 0;
    const video = document.querySelector('.admin-view-video');
    if (!video?.videoWidth) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let bright = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 160) bright++;
    return bright > 20;
  });
  await player.evaluate(() => { window.captureCalls = 0; window.nativeDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getDisplayMedia = async () => { window.captureCalls++; throw new Error('Tab capture must not be used automatically'); }; });
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
    return at >= 0 && items[at + 1].label === 'Live View' && !items.some(i => i.label === 'Admin Spectate' || i.label === 'Live interface view');
  }), true, 'Live View is immediately beside regular Spectate');
  await admin.evaluate(() => AshtonkMania.AdminGameView.request(AshtonkMania.Presence.players.find(u => u.name === 'Player')));
  assert.equal(await player.getByRole('button', { name: 'Share game tab', exact: true }).count(), 0, 'No recurring approval request');
  try { await admin.waitForFunction(() => document.querySelector('.admin-view-video')?.videoWidth > 0, null, { timeout: 30000 }); }
  catch (e) { for (const [label, pg] of [['player', player], ['admin', admin]]) console.error(label, JSON.stringify(await pg.evaluate(() => ({ captureError: AshtonkMania.AdminGameView.current?.captureError, messages: window.viewMessages, stops: window.viewStops, current: AshtonkMania.AdminGameView.current && { host: AshtonkMania.AdminGameView.current.host, session: AshtonkMania.AdminGameView.current.session, pc: AshtonkMania.AdminGameView.current.pc?.connectionState, ice: AshtonkMania.AdminGameView.current.pc?.iceConnectionState, handle: AshtonkMania.AdminGameView.handle }, toasts: document.querySelector('#toasts').textContent })), null, 2)); throw e; }
  assert.equal(await player.evaluate(() => !!AshtonkMania.AdminGameView.current.capture), true, 'The game renders its own UI without display capture');
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.pc.connectionState), 'connected');
  try { await visibleVideo(); } catch (e) {
    for (const [label, page] of [['source', player], ['viewer', admin]]) console.error(label, JSON.stringify(await page.evaluate(() => { const s = AshtonkMania.AdminGameView.current, m = s?.menu; return { errors: window.viewStops, menu: m && { error: m.error, busy: m.busy, reset: m.reset, active: m.active, ready: m.ready, disabled: m.disabled, paused: m.paused, rendered: m.rendered, updates: m.updates, queued: m.queue.length, epoch: m.epoch, currentEpoch: m.currentEpoch, channel: m.channel.readyState, hidden: m.el?.hidden, html: m.iframe?.contentDocument?.body?.innerHTML.slice(0, 500) }, remotePaused: s?.remotePaused, capture: s?.capture && { suspended: s.capture.suspended, paused: s.capture.paused } }; })));
    console.error('page errors', errors); throw e;
  }
  assert.equal(await admin.locator('.admin-view-video').evaluate(el => {
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && css.opacity === '1' && css.filter === 'none';
  }), true, 'Video fills the viewport without dimming');
  assert.equal(await player.evaluate(() => { const c = AshtonkMania.AdminGameView.current.capture.canvas; return Math.min(c.width, c.height) >= 720 && Math.max(c.width, c.height) <= Math.max(1920, 720 * Math.max(innerWidth / innerHeight, innerHeight / innerWidth)) + 1 && Math.abs(c.width / c.height - innerWidth / innerHeight) < .01; }), true, 'Adaptive capture preserves aspect ratio with a 720p minimum');
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.manual), true, 'Only budgeted frames are submitted to the encoder');
  assert.equal(await player.evaluate(() => window.captureCalls), 0);
  if (process.env.SOURCE_MOBILE === '1') {
    await player.setViewportSize({ width: 390, height: 844 });
    await player.waitForFunction(() => { const c = AshtonkMania.AdminGameView.current.capture.canvas; return c.width >= 720 && c.height >= 1558 && c.height > c.width; });
    await admin.waitForFunction(() => AshtonkMania.AdminGameView.current.menu.width === 390 && !AshtonkMania.AdminGameView.current.menu.el.hidden);
    await player.setViewportSize({ width: 844, height: 390 });
    await admin.waitForFunction(() => AshtonkMania.AdminGameView.current.menu.width === 844 && !AshtonkMania.AdminGameView.current.menu.el.hidden);
  }

  await admin.evaluate(() => {
    window.handoffGaps = []; window.handoffMonitoring = true;
    const frame = () => { if (!window.handoffMonitoring) return; const s = AshtonkMania.AdminGameView.current, m = s?.menu; if (m?.hasSnapshot && !m.paused && !s.remotePaused && m.el.hidden && s.video.style.visibility === 'hidden') window.handoffGaps.push(performance.now()); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });

  await player.evaluate(() => AshtonkMania.Screens.go('profile'));
  await admin.waitForFunction(() => !!AshtonkMania.AdminGameView.current?.menu?.iframe?.contentDocument?.querySelector('.pf-cover'));
  await player.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await player.getByRole('button', { name: 'Aurora profile style', exact: true }).click();
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current?.menu?.updates > 1);
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.fullSnapshots), 0, 'Menu viewing takes no page screenshots');
  assert.equal(await player.evaluate(() => !!window.modernScreenshot), false, 'The source does not load the screenshot renderer for menus');
  const throttle = await player.context().newCDPSession(player); await throttle.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const startUpdates = await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.updates);
  await player.evaluate(() => {
    window.menuPerf = { times: [], tasks: [], start: performance.now() + 1000, index: 0 };
    const el = h('div', { id: 'menu-perf', style: { position: 'fixed', top: '110px', left: '20px', zIndex: 9999, color: '#fff', background: '#18171c' } }, 'Menu update 0'); document.querySelector('#app').append(el);
    window.menuPerf.timer = setInterval(() => { el.textContent = 'Menu update ' + ++window.menuPerf.index; }, 50);
    const frame = t => { if (t >= window.menuPerf.start) window.menuPerf.times.push(t); window.menuPerf.raf = requestAnimationFrame(frame); }; window.menuPerf.raf = requestAnimationFrame(frame);
    window.menuPerf.observer = new PerformanceObserver(list => window.menuPerf.tasks.push(...list.getEntries().filter(e => e.startTime >= window.menuPerf.start).map(e => e.duration))); window.menuPerf.observer.observe({ type: 'longtask', buffered: false });
  });
  await player.waitForTimeout(6000);
  const seenIndex = await admin.evaluate(() => Number(AshtonkMania.AdminGameView.current.menu.iframe.contentDocument.querySelector('#menu-perf')?.textContent.match(/\d+/)?.[0]));
  const metrics = await player.evaluate(() => {
    const p = window.menuPerf, dt = p.times.slice(1).map((t, i) => t - p.times[i]).sort((a, b) => a - b);
    const result = { fps: (p.times.length - 1) * 1000 / (p.times.at(-1) - p.times[0]), p95FrameMs: dt[Math.floor(dt.length * .95)], longTasks: p.tasks.length, longTaskMs: p.tasks.reduce((a, b) => a + b, 0), last: p.index, screenshots: AshtonkMania.AdminGameView.current.capture.fullSnapshots, pixels: AshtonkMania.AdminGameView.current.capture.paintedFrames };
    clearInterval(p.timer); cancelAnimationFrame(p.raf); p.observer.disconnect(); document.querySelector('#menu-perf').remove(); return result;
  });
  await throttle.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const changed = await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.updates) - startUpdates;
  assert.ok(metrics.fps > 45, JSON.stringify(metrics)); assert.equal(metrics.screenshots, 0); assert.equal(metrics.pixels, 0);
  assert.ok(metrics.last - seenIndex < 8, 'Menu updates arrive within eight 50ms changes'); assert.ok(changed > 50, 'Fresh menu updates are not limited to low video FPS');
  console.log('MENU PERFORMANCE 4x CPU:', JSON.stringify({ ...metrics, viewerUpdates: changed, viewerLagInUpdates: metrics.last - seenIndex }));
  await admin.evaluate(() => { window.menuExecuted = 0; });
  await player.evaluate(() => {
    const channel = AshtonkMania.AdminGameView.current.menu.channel;
    const send = (v, k) => channel.send(JSON.stringify({ k, i: 0, n: 1, d: JSON.stringify(v) }));
    send({ t: 'mode', active: true, blocked: false, epoch: 99999 }, 900000);
    send({ t: 'snapshot', epoch: 99999, w: 1440, h: 960, html: {}, tree: { i: 1, t: 'body', a: {}, c: [
      { i: 2, t: 'script', a: {}, c: [{ i: 3, x: 'parent.menuExecuted=1' }] },
      { i: 4, t: 'iframe', a: { src: '/admin' }, c: [] },
      { i: 5, t: 'img', a: { src: 'https://example.invalid/tracker', onerror: 'parent.menuExecuted=1', style: 'background-image:url(https://example.invalid/tracker)' }, c: [] },
      { i: 6, t: 'svg', a: {}, c: [{ i: 7, t: 'foreignObject', a: {}, c: [] }] },
      { i: 8, t: 'input', a: { type: 'file', value: 'C:/fakepath/test.osz' }, c: [] },
      { i: 9, t: 'div', a: { id: 'after-file-input' }, c: [{ i: 10, x: 'Still renders' }] }
    ] } }, 900001);
  });
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current.menu.epoch === 99999);
  assert.equal(await admin.evaluate(() => window.menuExecuted), 0);
  assert.equal(await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.iframe.contentDocument.querySelectorAll('script, iframe, [onerror], foreignObject, img[src^="https:"]').length), 0);
  assert.equal(await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.iframe.getAttribute('sandbox')), 'allow-same-origin', 'Remote content has no script permission');
  assert.equal(await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.iframe.contentDocument.querySelector('#after-file-input')?.textContent), 'Still renders', 'Selected file inputs cannot abort a menu snapshot');
  await admin.evaluate(() => AshtonkMania.AdminGameView.current.menu.setPaused(false));
  await admin.waitForFunction(() => AshtonkMania.AdminGameView.current.menu.epoch !== 99999 && !!AshtonkMania.AdminGameView.current.menu.iframe.contentDocument.querySelector('.pf-cover'));

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
  await player.waitForFunction(() => AshtonkMania.AdminGameView.current?.menu?.active && AshtonkMania.AdminGameView.current.menu.updates > 0);
  await admin.waitForFunction(() => !!AshtonkMania.AdminGameView.current?.menu?.iframe?.contentDocument?.querySelector('.pf-cover'));
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
  await player.waitForFunction(() => AshtonkMania.AdminGameView.current?.capture?.hudSnapshots > 0);
  assert.equal(await player.evaluate(() => AshtonkMania.AdminGameView.current.capture.root === AshtonkMania.GameplayScreen.hud), true, 'Gameplay snapshots use only the HUD, never the whole document');
  const lateBackground = await player.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 2; const x = c.getContext('2d'); x.fillStyle = '#192744'; x.fillRect(0, 0, 2, 2);
    const url = c.toDataURL(); AshtonkMania.GameplayScreen.bgEl.style.backgroundImage = `url("${url}")`; return url;
  });
  await player.waitForFunction(url => AshtonkMania.AdminGameView.current.capture.background?.src === url, lateBackground);

  await visibleVideo();
  await admin.waitForFunction(() => { const s = AshtonkMania.AdminGameView.current; return s?.menu && !s.menu.active && s.menu.el.hidden && s.video.style.visibility !== 'hidden'; });
  if (process.env.SHOT_DIR) await admin.screenshot({ path: join(process.env.SHOT_DIR, process.env.SOURCE_MOBILE ? 'admin-live-gameplay-mobile.png' : 'admin-live-gameplay.png') });
  await player.evaluate(() => AshtonkMania.Screens.go('songselect'));
  await admin.waitForFunction(() => { const m = AshtonkMania.AdminGameView.current?.menu; return m?.active && !m.el.hidden && !!m.iframe.contentDocument.querySelector('.ss'); });
  assert.deepEqual(await admin.evaluate(() => { window.handoffMonitoring = false; return window.handoffGaps; }), [], 'Screen handoffs always retain a visible menu or video frame');
  if (process.env.EXACT_TAB === '1') {
    await player.evaluate(() => {
      document.title = 'Exact game tab test'; window.beforeExactCapture = AdminGameView.current.capture;
      navigator.mediaDevices.getDisplayMedia = options => { window.captureCalls++; return window.nativeDisplayMedia(options); };
      const proof = h('section#exact-proof', { style: { position: 'fixed', left: '20px', top: '180px', width: '240px', height: '90px', zIndex: 9999 } });
      proof.attachShadow({ mode: 'closed' }).innerHTML = '<div style="width:240px;height:90px;background:rgb(12,230,80);color:#000;font:20px Arial">Closed shadow overlay</div>';
      document.body.append(proof);
    });
    await player.getByRole('button', { name: 'Share exact tab', exact: true }).click();
    try { await player.waitForFunction(() => AdminGameView.current?.capture?.native && AdminGameView.current.capture.ready, null, { timeout: 20000 }); }
    catch (e) { console.error('Exact view:', await player.evaluate(() => ({ status: document.querySelector('#toasts').textContent, switching: AdminGameView.current?.switching, native: AdminGameView.current?.capture?.native, metrics: AdminGameView.current?.capture?.metrics, settings: AdminGameView.current?.track?.getSettings() }))); throw e; }
    await admin.waitForFunction(() => { const s = AdminGameView.current; return s.menu.el.hidden && s.video.style.visibility !== 'hidden'; });
    assert.equal(await player.evaluate(() => window.beforeExactCapture.stopped && window.beforeExactCapture.canvas.width === 0 && !AdminGameView.current.capture.canvas), true, 'Exact view stops the duplicate JS snapshot/canvas renderer');
    await admin.waitForFunction(() => {
      const v = AdminGameView.current.video, c = document.createElement('canvas'); c.width = c.height = 1;
      const x = c.getContext('2d'); x.drawImage(v, v.videoWidth * 30 / 1440, v.videoHeight * 200 / 960, 1, 1, 0, 0, 1, 1); const p = x.getImageData(0, 0, 1, 1).data;
      return p[0] < 60 && p[1] > 190 && p[2] < 130;
    });
    const nativeCpuRate = Number(process.env.EXACT_CPU_RATE || 1);
    const nativeThrottle = await player.context().newCDPSession(player); await nativeThrottle.send('Emulation.setCPUThrottlingRate', { rate: nativeCpuRate });
    await player.evaluate(() => {
      Settings.set('graphics.fpsLimit', 60);
      window.nativePerf = { frames: [], rafs: [], work: [], tasks: [], start: Infinity }; const p = window.nativePerf, cap = AdminGameView.current.capture, end = cap.gameFrameEnd;
      cap.gameFrameEnd = (ts, work, limit, drawn) => { if (ts >= p.start) { p.rafs.push(ts); if (drawn) { p.frames.push(ts); p.work.push(work); } } end(ts, work, limit, drawn); };
      p.observer = new PerformanceObserver(list => p.tasks.push(...list.getEntries().filter(x => x.startTime >= p.start).map(x => x.duration))); p.observer.observe({ type: 'longtask' });
      const map = [...BeatmapManager.maps.values()].find(m => m.keys === 4 && !m.problems.length); Game.launch({ mapId: map.id, mods: ['NF'], mode: 'play' });
    });
    await player.waitForFunction(() => GameplayScreen.s?.running); await player.waitForTimeout(1000);
    await player.evaluate(() => { window.nativePerf.start = performance.now(); });
    const decoded = await admin.evaluate(() => ({ frames: AdminGameView.current.video.getVideoPlaybackQuality().totalVideoFrames, at: performance.now() }));
    await player.waitForTimeout(6000);
    const remote = await admin.evaluate(before => ({ fps: (AdminGameView.current.video.getVideoPlaybackQuality().totalVideoFrames - before.frames) * 1000 / (performance.now() - before.at), width: AdminGameView.current.video.videoWidth, height: AdminGameView.current.video.videoHeight }), decoded);
    const perf = await player.evaluate(() => {
      const p = window.nativePerf, f = p.frames, dt = f.slice(1).map((x, i) => x - f[i]).sort((a, b) => a - b); p.observer.disconnect();
      return { fps: (f.length - 1) * 1000 / (f.at(-1) - f[0]), rafFps: (p.rafs.length - 1) * 1000 / (p.rafs.at(-1) - p.rafs[0]), meanGameWorkMs: p.work.reduce((a, b) => a + b, 0) / p.work.length, displayMs: GameplayScreen._refresh, verification: AdminGameView.current.capture.verification, p95FrameMs: dt[Math.floor(dt.length * .95)], longTasks: p.tasks.length, longTaskMs: p.tasks.reduce((a, b) => a + b, 0), encoder: AdminGameView.current.capture.metrics };
    });
    await nativeThrottle.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(`EXACT TAB PERFORMANCE ${nativeCpuRate}x CPU:`, JSON.stringify({ softwareGPU, source: perf, viewer: remote }));
    // The standard run checks the 60fps player target. Stress runs report the device's actual capacity: source
    // compositing/encoding cannot be guaranteed at 60fps on a software GPU with an artificially slowed CPU.
    assert.ok(perf.fps > (nativeCpuRate > 1 ? 25 : softwareGPU ? 35 : 50), 'Native sharing keeps the source game responsive at this runner’s graphics capability'); assert.ok(remote.fps > 20, 'The real WebRTC viewer receives smooth game frames');
    await player.getByRole('button', { name: 'Pause sharing', exact: true }).click();
    assert.equal(await player.evaluate(() => AdminGameView.current.track.enabled), false);
    await admin.waitForFunction(() => AdminGameView.current.remotePaused);
    await player.getByRole('button', { name: 'Resume sharing', exact: true }).click();
    await player.evaluate(() => CodePanel.open()); await admin.waitForFunction(() => AdminGameView.current.remotePaused);
    assert.equal(await player.evaluate(() => AdminGameView.current.track.enabled), false, 'Native capture blacks known account panels');
    await admin.waitForFunction(() => {
      const v = AdminGameView.current.video, c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 16, 16);
      return x.getImageData(0, 0, 16, 16).data.every((n, i) => i % 4 === 3 || n < 10);
    });
    await player.evaluate(() => CodePanel.close()); await admin.waitForFunction(() => !AdminGameView.current.remotePaused);
    await player.evaluate(() => { document.querySelector('#exact-proof').remove(); Screens.go('songselect'); });
    await player.getByRole('button', { name: 'Use lightweight view', exact: true }).click();
    await player.waitForFunction(() => !AdminGameView.current.capture.native && !AdminGameView.current.switching);
    await admin.waitForFunction(() => AdminGameView.current.menu.active && !AdminGameView.current.menu.el.hidden);
    assert.equal(await player.evaluate(() => window.captureCalls), 1, 'Only the explicit player action opened the tab picker');
    console.log('PASS: real browser tab capture, verified current tab, exact closed-shadow visuals, no duplicate renderer, live native WebRTC, pause/privacy and return to lightweight view');
  }
  await admin.getByRole('button', { name: 'Stop watching', exact: true }).click();
  await player.waitForFunction(() => !AshtonkMania.AdminGameView.current);
  // More than the server's short rejoin cooldown has elapsed during the checks above.
  await admin.evaluate(() => AshtonkMania.AdminGameView.start(AshtonkMania.Presence.players.find(u => u.name === 'Player'), true));
  await player.locator('#toasts').filter({ hasText: 'Live View' }).waitFor();
  await visibleVideo();
  assert.equal(await player.evaluate(() => window.captureCalls), process.env.EXACT_TAB === '1' ? 1 : 0, 'Rejoining never asks the player to share a tab');
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
