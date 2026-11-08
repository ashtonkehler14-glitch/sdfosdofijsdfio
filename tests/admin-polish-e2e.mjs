// MINIFLARE_DIR=<dir> CHROMIUM_PATH=/usr/bin/chromium SHOT_DIR=<dir> node tests/admin-polish-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const { Miniflare } = createRequire(join(process.env.MINIFLARE_DIR || process.cwd(), 'package.json'))('miniflare');
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), code = 'K7QM3XRA9DPZW2HF';
const mf = new Miniflare({ modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, host: '127.0.0.1', port: 0,
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' }, bindings: { ADMIN_CODE: code, TEST_ALL_RANKED: '1' },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try {
      return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(f)] || 'application/octet-stream' } });
    } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
});
let browser;
try {
  const url = String(await mf.ready).replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [], csp = [];
  async function game(name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      await page.click('.setup-choice[data-id="new"]'); await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom'); await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.waitForFunction(() => AshtonkMania.Presence.me && AshtonkMania.Account.code());
    await page.evaluate(() => { while (Overlays.top()) Overlays.top().close(); }); return page;
  }
  const player = await game('Player'), recoveryDevice = await game('Recovery device');
  const identity = await player.evaluate(() => ({ pid: AshtonkMania.Presence.pid(), code: AshtonkMania.Account.code() }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }), panel = await context.newPage();
  panel.on('pageerror', e => errors.push(e.message));
  await panel.addInitScript(() => { window.cspErrors = []; document.addEventListener('securitypolicyviolation', e => window.cspErrors.push(e.violatedDirective)); });
  await panel.goto(url + '/admin'); await panel.fill('#code', code); await panel.click('#go'); await panel.waitForSelector('.top');
  await panel.waitForSelector('main .grid .tile');
  assert.match(await panel.locator('.hero h2').textContent(), /Overview/);
  assert.equal(await panel.locator('.panel-neru img').evaluate(el => el.complete && el.naturalWidth > 0), true);
  if (process.env.SHOT_DIR) await panel.screenshot({ path: join(process.env.SHOT_DIR, 'admin-polished-overview.png') });
  await panel.getByRole('button', { name: 'Neru', exact: true }).click();
  await panel.waitForSelector('.neru-spark');
  await panel.keyboard.type('neru'); await panel.waitForSelector('.neru-egg');
  await panel.evaluate(pid => { location.hash = 'players/' + pid; }, identity.pid);
  await panel.getByRole('button', { name: 'Get sign-in code', exact: true }).click();
  const temporary = await panel.getByRole('textbox', { name: 'Player sign-in code', exact: true }).inputValue();
  assert.notEqual(temporary, identity.code);
  if (process.env.SHOT_DIR) {
    await panel.locator('.code-value').evaluate(el => { el.value = '••••-••••-••••-••••'; });
    await panel.screenshot({ path: join(process.env.SHOT_DIR, 'admin-polished-player.png') });
  }
  const linked = await recoveryDevice.evaluate(async c => {
    const A = AshtonkMania, d = await A.Account.link(c);
    return { pid: d.pid, recovery: d.recovery, shownCode: A.Account.code(), linked: A.Account.linked() };
  }, temporary);
  assert.deepEqual(linked, { pid: identity.pid, recovery: true, shownCode: '', linked: true });
  const reuse = await fetch(url + '/api/account/link', { method: 'POST', body: JSON.stringify({ code: temporary }) }); assert.equal(reuse.status, 401);
  assert.equal(await player.evaluate(() => AshtonkMania.Account.code()), identity.code);
  await panel.getByRole('button', { name: 'Generate another code', exact: true }).click();
  await panel.waitForFunction(() => /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(document.querySelector('.code-value')?.value));
  const revoked = await panel.getByRole('textbox', { name: 'Player sign-in code' }).inputValue();
  await panel.getByRole('button', { name: 'Revoke code', exact: true }).click();
  assert.equal((await fetch(url + '/api/account/link', { method: 'POST', body: JSON.stringify({ code: revoked }) })).status, 401);
  assert.equal(await panel.locator('.code-result').isVisible(), false);
  for (const tab of ['reports', 'players', 'announce', 'chat', 'boards', 'playlists', 'daily', 'log']) {
    await panel.evaluate(tab => { location.hash = tab; }, tab);
    await panel.waitForFunction(tab => document.querySelector('.hero h2')?.textContent.toLowerCase() === ({ announce: 'announcements', boards: 'leaderboards', daily: 'daily challenge' }[tab] || tab), tab);
    await panel.waitForFunction(() => !document.querySelector('.empty.loading'));
    assert.equal(await panel.locator('.panel-neru img').evaluate(el => el.complete && el.naturalWidth > 0), true);
  }
  await panel.setViewportSize({ width: 390, height: 844 }); await panel.evaluate(() => { location.hash = 'overview'; });
  await panel.waitForSelector('main .grid');
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile layout does not overflow');
  await panel.getByRole('button', { name: 'Neru', exact: true }).click();
  if (process.env.SHOT_DIR) await panel.screenshot({ path: join(process.env.SHOT_DIR, 'admin-polished-mobile.png'), fullPage: true });
  csp.push(...await panel.evaluate(() => window.cspErrors));
  await player.evaluate(() => { AshtonkMania.Screens.go('changelog'); });
  await player.waitForFunction(() => AshtonkMania.Screens.currentName === 'changelog');
  assert.equal(await player.evaluate(() => /admin|moderator|owner|staff/i.test(document.querySelector('.cl-page')?.textContent || CHANGELOG.map(x => JSON.stringify(x)).join(''))), false);
  await player.evaluate(() => { document.activeElement?.blur(); });
  await player.keyboard.type('neru');
  assert.equal(await player.waitForFunction(() => !!document.querySelector('.nc-peek, .neru-cameo .neru-spark')).then(() => true, () => false), true, 'Neru menu easter egg runs in the game');
  assert.deepEqual(csp, []); assert.deepEqual(errors, []);
  console.log('PASS: polished desktop/mobile panel, all tabs and Neru poses, interactive easter eggs, single-use/revocable player sign-in code through the actual game, unchanged permanent code, no CSP or page errors, changelog excludes admin entries');
} finally { await browser?.close(); await mf.dispose(); }
