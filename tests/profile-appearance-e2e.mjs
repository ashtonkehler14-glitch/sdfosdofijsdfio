// MINIFLARE_DIR=<directory with node_modules/miniflare> CHROMIUM_PATH=/usr/bin/chromium node tests/profile-appearance-e2e.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const { Miniflare } = createRequire(join(process.env.MINIFLARE_DIR || process.cwd(), 'package.json'))('miniflare');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const persist = mkdtempSync(join(tmpdir(), 'am-profiles-'));
const ownerCode = 'K7QM3XRA9DPZW2HF';
const opts = {
  modules: true, scriptPath: join(root, 'worker/index.js'), modulesRoot: root, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2026-08-01', cf: false, port: 0, host: '127.0.0.1',
  durableObjects: { ROOMS: 'MatchRoom', MATCHMAKER: 'Matchmaker', VAULT: 'PlayerVault' }, durableObjectsPersist: persist,
  bindings: { ADMIN_CODE: ownerCode },
  serviceBindings: { ASSETS: async req => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    for (const f of [p === '/' ? join(root, 'index.html') : join(root, p), join(root, 'public', p)]) try {
      return new Response(readFileSync(f), { headers: { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' })[extname(f)] || 'application/octet-stream' } });
    } catch { /* next */ }
    return new Response('not found', { status: 404 });
  } },
};
const mf = new Miniflare(opts);
let browser;
try {
  const url = String(await mf.ready).replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function device(name, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 960 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => localStorage.setItem('am.noInstallPrompt', '1'));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#loading-screen.done'));
    if (await page.$('.onboarding')) {
      if (await page.$('.setup-choice[data-id="new"]')) await page.click('.setup-choice[data-id="new"]');
      await page.fill('.onboarding .ob-name', name); await page.keyboard.press('Enter');
      await page.waitForSelector('.setup-step-wom, .setup-step-mobile');
      await page.evaluate(() => AshtonkMania.Onboarding.finish());
    }
    await page.waitForFunction(() => AshtonkMania.Presence.me && AshtonkMania.Account.code());
    await page.evaluate(() => { while (Overlays.top()) Overlays.top().close(); AshtonkMania.Screens.go('profile', { force: true }); });
    await page.waitForSelector('.pf-customize');
    return page;
  }
  const alice = await device('Alice'), bob = await device('Bob');
  const alicePid = await alice.evaluate(() => AshtonkMania.Presence.pid());
  const aliceCode = await alice.evaluate(() => AshtonkMania.Account.code());
  await alice.evaluate(async () => {
    const blob = await (await fetch('/tests/fixtures/test-set.osz')).blob();
    await AshtonkMania.App.importFiles([new File([blob], 'test-set.osz')]);
  });
  await alice.waitForFunction(() => AshtonkMania.BeatmapManager.sets.length > 0);
  await alice.evaluate(() => { while (Overlays.top()) Overlays.top().close(); AshtonkMania.Screens.go('profile', { force: true }); });
  await alice.waitForFunction(() => document.querySelectorAll('.pf-customize').length === 1);
  await alice.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await alice.getByRole('button', { name: 'Save changes', exact: true }).focus();
  await alice.keyboard.press('Tab');
  assert.equal(await alice.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close profile editor');
  await alice.getByRole('button', { name: 'Aurora profile style' }).click();
  await alice.fill('#pa-bio', 'Here for the music. Staying for the streams.');
  const image = await alice.evaluate(() => { const c = document.createElement('canvas'); c.width = 1440; c.height = 700; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1440, 700); g.addColorStop(0, '#163047'); g.addColorStop(.5, '#3ea98d'); g.addColorStop(1, '#7d5ab3'); x.fillStyle = g; x.fillRect(0, 0, 1440, 700); return c.toDataURL('image/png').split(',')[1]; });
  // Theme selection is independent even while a background image is still processing.
  await alice.evaluate(() => {
    const A = AshtonkMania.ProfileAppearance, original = A.packBanner;
    A.packBanner = async function (...args) { A.packBanner = original; await new Promise(resolve => { window.releaseProfileUpload = resolve; }); return original.apply(this, args); };
  });
  await alice.locator('input[type=file][aria-label="Upload profile banner"]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await alice.waitForFunction(() => typeof window.releaseProfileUpload === 'function');
  await alice.getByRole('button', { name: 'Miku profile style', exact: true }).click();
  await alice.evaluate(() => window.releaseProfileUpload());
  await alice.waitForFunction(() => document.querySelector('.pa-status').textContent.includes('Banner ready'));
  assert.equal(await alice.locator('.pa-preview').getAttribute('data-profile-style'), 'miku');
  await alice.getByRole('button', { name: 'Aurora profile style', exact: true }).click();
  await alice.locator('#pa-position').fill('25'); await alice.locator('#pa-position').dispatchEvent('input');
  const draft = await alice.evaluate(() => ({ style: document.querySelector('.pa-preview').dataset.profileStyle, image: document.querySelector('.pa-preview-cover').style.backgroundImage, saved: AshtonkMania.ProfileManager.profile.appearance }));
  assert.equal(draft.style, 'aurora'); assert.ok(draft.image.includes('data:image/')); assert.equal(draft.saved, undefined);
  if (process.env.SHOT_DIR) await alice.screenshot({ path: join(process.env.SHOT_DIR, 'profile-editor-desktop.png') });
  await alice.getByRole('button', { name: 'Save changes', exact: true }).click();
  await alice.waitForSelector('.pa-editor', { state: 'detached' });
  assert.equal(await alice.locator('.pf-header').getAttribute('data-profile-style'), 'aurora');
  assert.match(await alice.locator('.pf-bio').textContent(), /Here for the music/);
  await alice.reload(); await alice.waitForFunction(() => document.querySelector('#loading-screen.done'));
  await alice.evaluate(() => { while (Overlays.top()) Overlays.top().close(); AshtonkMania.Screens.go('profile', { force: true }); });
  await alice.waitForSelector('.pf-header[data-profile-style=aurora]');
  const saved = await alice.evaluate(() => AshtonkMania.ProfileManager.profile.appearance);
  assert.equal(saved.position, 25); assert.ok(saved.banner.length <= 48000);
  await alice.getByRole('button', { name: 'Customize profile', exact: true }).click();
  assert.equal(await alice.locator('#pa-bio').inputValue(), saved.bio);
  await alice.getByRole('button', { name: 'Ember profile style' }).click();
  await alice.getByRole('button', { name: 'Cancel', exact: true }).click();
  await alice.waitForSelector('.pa-editor', { state: 'detached' });
  assert.equal(await alice.locator('.pf-header').getAttribute('data-profile-style'), 'aurora');
  console.log('PASS: banner upload, live preview, save/reload, focal position and cancel');

  await bob.evaluate(pid => AshtonkMania.Screens.go('profile', { pid, name: 'Alice', force: true }), alicePid);
  await bob.waitForSelector('.pf-header[data-profile-style=aurora]');
  await bob.waitForFunction(() => !document.querySelector('.pf-customize'));
  assert.equal(await bob.locator('.pf-customize').count(), 0);
  assert.equal(await bob.locator('.pf-bio').textContent(), saved.bio);
  assert.ok((await bob.locator('.pf-cover').getAttribute('style')).includes('data:image/'));
  const post = (path, body, cookie = '') => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin': '1', cookie }, body: JSON.stringify(body) });
  assert.equal((await post('/admin/api/profileTags', { pid: alicePid, tags: [] })).status, 401);
  const login = await post('/admin/api/login', { code: ownerCode }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const tag = { name: 'Skin creator', colour: '#72e4c1' };
  assert.equal((await post('/admin/api/profileTags', { pid: alicePid, tags: [tag] }, cookie)).status, 200);
  await bob.waitForSelector('.pf-community-tag');
  assert.equal(await bob.locator('.pf-community-tag').textContent(), tag.name);
  await alice.waitForSelector('.pf-community-tag');
  assert.equal(await alice.evaluate(() => AshtonkMania.Presence.isAdmin === true), false);
  assert.equal((await post('/admin/api/login', { code: aliceCode })).status, 401);
  console.log('PASS: remote profile sharing, live admin tags, unauthenticated assignment rejected, tags confer no admin access');

  // Previewing the admin page also catches inline-script syntax errors under its strict CSP.
  const admin = await browser.newPage(); admin.on('pageerror', e => errors.push(e.message));
  await admin.context().addCookies([{ name: 'am_admin', value: cookie.slice('am_admin='.length), url: url + '/admin' }]);
  await admin.goto(url + '/admin#player/' + alicePid);
  await admin.waitForSelector('main').catch(async e => { console.error('Admin page:', await admin.title(), errors, await admin.locator('body').innerText()); throw e; });
  await admin.evaluate(pid => openPlayer(pid), alicePid);
  await admin.waitForSelector('input[aria-label="Profile tag name"]');
  assert.equal(await admin.locator('input[aria-label="Profile tag name"]').inputValue(), 'Skin creator');
  await admin.getByRole('button', { name: '+ Add tag', exact: true }).click();
  await admin.locator('input[aria-label="Profile tag name"]').nth(1).fill('Stream master');
  await admin.getByRole('button', { name: 'Save tags', exact: true }).click();
  await bob.waitForFunction(() => document.querySelectorAll('.pf-community-tag').length === 2);
  console.log('PASS: admin tag controls render and assign tags');
  if (process.env.SHOT_DIR) await bob.screenshot({ path: join(process.env.SHOT_DIR, 'profile-page-desktop.png') });

  // Sign in on a third device: the real vault/sync flow restores the complete appearance.
  await alice.evaluate(async () => { await AshtonkMania.Sync.push(); });
  const charlie = await device('Charlie');
  await charlie.evaluate(async code => { await AshtonkMania.Account.link(code); await AshtonkMania.Sync.restore(); }, aliceCode);
  await charlie.waitForFunction(() => AshtonkMania.ProfileManager.profile.appearance?.style === 'aurora');
  const restored = await charlie.evaluate(() => AshtonkMania.ProfileManager.profile.appearance);
  assert.deepEqual(restored, saved);
  console.log('PASS: full appearance restored through account sync on another device');
  const mobile = await device('Mobile', true);
  await mobile.evaluate(async p => { await AshtonkMania.ProfileManager.applyKept(p); AshtonkMania.Screens.go('profile', { force: true }); }, { appearance: saved });
  await mobile.waitForFunction(() => document.querySelectorAll('.pf-bio').length === 1 && document.querySelector('.pf-customize'));
  await mobile.getByRole('button', { name: 'Customize profile', exact: true }).click();
  assert.ok(await mobile.locator('.pa-editor').evaluate(el => el.getBoundingClientRect().width >= innerWidth * .8));
  await mobile.getByRole('button', { name: 'Cancel', exact: true }).click();
  await mobile.waitForSelector('.pa-editor', { state: 'detached' });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await mobile.getByRole('button', { name: 'Midnight profile style' }).click();
  const overflow = await mobile.evaluate(() => { const p = document.querySelector('.pa-editor'), b = p.getBoundingClientRect(); return { x: b.x, right: b.right, bottom: b.bottom, width: innerWidth, height: innerHeight, panelWidth: b.width, scrollWidth: p.scrollWidth, clientWidth: p.clientWidth }; });
  assert.ok(overflow.x >= 0 && overflow.right <= overflow.width + 1 && overflow.bottom <= overflow.height + 1 && overflow.scrollWidth <= overflow.clientWidth + 1 && overflow.panelWidth >= overflow.width * .8, JSON.stringify(overflow));
  await mobile.locator('.pa-body').evaluate(el => { el.scrollTop = 0; });
  if (process.env.SHOT_DIR) await mobile.screenshot({ path: join(process.env.SHOT_DIR, 'profile-editor-mobile.png') });
  await mobile.getByRole('button', { name: 'Save changes', exact: true }).click();
  await mobile.waitForSelector('.pa-editor', { state: 'detached' });
  await mobile.waitForSelector('.pf-header[data-profile-style=midnight]');
  if (process.env.SHOT_DIR) await mobile.screenshot({ path: join(process.env.SHOT_DIR, 'profile-page-mobile.png') });
  await mobile.evaluate(pid => AshtonkMania.Screens.go('profile', { pid, name: 'Alice', force: true }), alicePid);
  await mobile.waitForFunction(() => !document.querySelector('.pf-customize'));
  await mobile.waitForSelector('.pf-community-tag');
  const profileFit = await mobile.locator('.pf-header').evaluate(el => { const header = el.getBoundingClientRect(), content = el.querySelector('.pf-top-in').getBoundingClientRect(); return content.bottom <= header.bottom + 1 && el.scrollWidth <= el.clientWidth + 1; });
  assert.equal(profileFit, true);
  console.log('PASS: appearance restore, mobile editor fit/readability, mobile save and remote profile layout');
  await alice.getByRole('button', { name: 'Customize profile', exact: true }).click();
  const uploadedPreview = await alice.locator('.pa-preview-cover').evaluate(el => el.style.backgroundImage);
  for (const name of ['Miku', 'Neru', 'Teto']) {
    await alice.getByRole('button', { name: name + ' profile style', exact: true }).click();
    assert.equal(await alice.locator('.pa-preview').getAttribute('data-profile-style'), name.toLowerCase());
    assert.equal(await alice.locator('.pa-editor').getAttribute('data-profile-style'), name.toLowerCase());
    assert.equal(await alice.locator('.pa-preview').getAttribute('data-background'), 'upload');
    assert.equal(await alice.locator('.pa-preview-cover').evaluate(el => el.style.backgroundImage), uploadedPreview);
    const art = alice.locator(`.pa-preset[data-style="${name.toLowerCase()}"] img`);
    assert.ok((await art.getAttribute('src')).includes(name === 'Neru' ? 'neru.png' : `profile-art/${name.toLowerCase()}.png`));
    await art.evaluate(async el => { await el.decode(); });
    assert.ok(await art.evaluate(el => el.naturalWidth > 256));
  }
  assert.equal(await alice.getByRole('button', { name: 'Preset artwork', exact: true }).count(), 0);
  await alice.getByRole('button', { name: 'Neru profile style', exact: true }).click();
  if (process.env.SHOT_DIR) await alice.screenshot({ path: join(process.env.SHOT_DIR, 'profile-menu-neru.png') });
  await alice.getByRole('button', { name: 'Selected song background', exact: true }).click();
  await alice.getByRole('button', { name: /^Use .+ as profile background$/ }).first().click();
  await alice.waitForFunction(() => document.querySelector('.pa-status').textContent === 'Song background ready.');
  assert.equal(await alice.locator('.pa-preview-cover').getAttribute('data-cover-kind'), 'image');
  await alice.getByRole('button', { name: 'Save changes', exact: true }).click();
  await alice.waitForSelector('.pa-editor', { state: 'detached' });
  const chosen = await alice.evaluate(() => AshtonkMania.ProfileManager.profile.appearance);
  assert.equal(chosen.background, 'song'); assert.ok(chosen.song.hash); assert.ok(chosen.song.title); assert.ok(chosen.banner.startsWith('data:image/'));
  await bob.waitForFunction(pid => { AshtonkMania.Presence.send({ t: 'profile', pid }); return !!document.querySelector('.pf-header[data-profile-style=neru][data-background=song]'); }, alicePid, { polling: 400 });
  assert.equal(await bob.locator('.pf-cover').getAttribute('data-cover-kind'), 'image');
  const songBefore = chosen.banner;
  await alice.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await alice.getByRole('button', { name: 'Miku profile style', exact: true }).click();
  assert.equal(await alice.locator('.pa-preview').getAttribute('data-background'), 'song');
  assert.ok((await alice.locator('.pa-preview-cover').evaluate(el => el.style.backgroundImage)).includes(songBefore));
  await alice.getByRole('button', { name: 'Save changes', exact: true }).click();
  await alice.waitForSelector('.pa-editor', { state: 'detached' });
  const theme = await alice.evaluate(() => {
    const A = AshtonkMania, root = A.ProfileScreen.page.closest('.ov');
    return { theme: root.dataset.profileStyle, hue: getComputedStyle(root).getPropertyValue('--o-h').trim(), background: A.ProfileManager.profile.appearance.background, image: A.ProfileManager.profile.appearance.banner };
  });
  assert.equal(theme.theme, 'miku'); assert.equal(theme.hue, '176'); assert.equal(theme.background, 'song'); assert.equal(theme.image, songBefore);
  await alice.reload(); await alice.waitForFunction(() => document.querySelector('#loading-screen.done'));
  await alice.evaluate(() => { while (Overlays.top()) Overlays.top().close(); AshtonkMania.Screens.go('profile', { force: true }); });
  await alice.waitForSelector('.pf-header[data-background=song]');
  await alice.getByRole('button', { name: 'Customize profile', exact: true }).click();
  await alice.getByRole('button', { name: 'Best play background', exact: true }).click();
  await alice.getByRole('button', { name: 'Save changes', exact: true }).click();
  await alice.waitForSelector('.pa-editor', { state: 'detached' });
  assert.equal(await alice.locator('.pf-header').getAttribute('data-background'), 'best');
  const bestCover = await alice.evaluate(async () => {
    const A = AshtonkMania, m = [...A.BeatmapManager.maps.values()][0], el = document.createElement('div');
    await A.ProfileAppearance.cover(el, { ...A.ProfileManager.profile.appearance, style: 'miku', background: 'best' }, { best: { mapHash: m.hash } });
    return { kind: el.dataset.coverKind, image: el.style.backgroundImage, size: el.style.backgroundSize };
  });
  assert.equal(bestCover.kind, 'image'); assert.ok(bestCover.image.includes('blob:')); assert.equal(bestCover.size, 'cover');
  console.log('PASS: official character assets, full profile themes, preserved upload/song backgrounds, remote/reloaded song backgrounds and best-play reset');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await mf.dispose(); }
